"use client";

import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { decodeEventLog, keccak256, parseEther, toBytes, type Hex } from "viem";
import { useAccount, usePublicClient, useWriteContract } from "wagmi";
import { CopyButton } from "@/components/copy-button";
import { Notice } from "@/components/ui";
import { AGENT_WORK_ESCROW_ABI } from "@/lib/abi";
import { txUrl } from "@/lib/chain";
import { MAX_BRIEF_CHARS, PUBLIC_CONFIG } from "@/lib/config";
import { friendlyError, isAddress, sameAddress } from "@/lib/format";

const DAY_SECONDS = 86_400;
const MAX_WINDOW_DAYS = 365;

type Phase = "idle" | "signing" | "confirming" | "storing" | "done";

export function CreateJobForm({ escrowAddress }: { escrowAddress: Hex }) {
  const router = useRouter();
  const { address, isConnected, chainId } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();

  const [title, setTitle] = useState("");
  const [provider, setProvider] = useState("");
  const [amount, setAmount] = useState("");
  const [days, setDays] = useState("7");
  const [brief, setBrief] = useState("");

  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<Hex | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);

  const briefHash = useMemo(
    () => (brief.length > 0 ? keccak256(toBytes(brief)) : null),
    [brief],
  );

  const amountWei = useMemo(() => {
    const trimmed = amount.trim();
    if (!trimmed) return null;
    try {
      const wei = parseEther(trimmed);
      return wei > 0n ? wei : null;
    } catch {
      return null;
    }
  }, [amount]);

  const dayCount = Number(days);
  const validDays = Number.isInteger(dayCount) && dayCount >= 1 && dayCount <= MAX_WINDOW_DAYS;
  const providerValid = isAddress(provider.trim());
  const selfDeal = providerValid && sameAddress(provider.trim(), address);
  const briefValid = brief.trim().length >= 20 && brief.length <= MAX_BRIEF_CHARS;
  const wrongChain = isConnected && chainId !== PUBLIC_CONFIG.chainId;

  const canSubmit =
    isConnected &&
    !wrongChain &&
    providerValid &&
    !selfDeal &&
    amountWei !== null &&
    validDays &&
    briefValid &&
    phase === "idle";

  const submit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      if (!canSubmit || !amountWei || !briefHash || !publicClient) return;

      setError(null);
      setPhase("signing");

      try {
        const deliverBy = BigInt(Math.floor(Date.now() / 1000) + dayCount * DAY_SECONDS);

        const hash = await writeContractAsync({
          address: escrowAddress,
          abi: AGENT_WORK_ESCROW_ABI,
          functionName: "createJob",
          args: [provider.trim() as Hex, briefHash, deliverBy],
          value: amountWei,
        });
        setTxHash(hash);
        setPhase("confirming");

        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        if (receipt.status !== "success") {
          throw new Error("The transaction did not go through. Nothing was charged and no job was created.");
        }

        // Read the job id back out of the event rather than guessing from jobCount, which races
        // against anyone else creating a job in the same block.
        let createdId: string | null = null;
        for (const log of receipt.logs) {
          if (log.address.toLowerCase() !== escrowAddress.toLowerCase()) continue;
          try {
            const decoded = decodeEventLog({
              abi: AGENT_WORK_ESCROW_ABI,
              data: log.data,
              topics: log.topics,
            });
            if (decoded.eventName === "JobCreated") {
              createdId = (decoded.args as { jobId: bigint }).jobId.toString();
              break;
            }
          } catch {
            // Not a JobCreated log; keep looking.
          }
        }
        if (!createdId) {
          throw new Error(
            "The job was created and your funds are in escrow, but this page could not read its number back. Look up the transaction on BOTScan to find it.",
          );
        }

        setJobId(createdId);
        setPhase("storing");

        // The escrow already holds the funds at this point. If storing the brief fails the job is
        // still live, so surface it as a warning on the outcome page rather than as a failure here.
        const response = await fetch("/api/jobs", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jobId: createdId, title: title.trim(), brief, txHash: hash }),
        });
        if (!response.ok) {
          const detail = (await response.json().catch(() => null)) as { error?: string } | null;
          throw new Error(
            `Funds are escrowed and job #${createdId} exists, but the brief could not be saved: ${
              detail?.error ?? response.statusText
            }`,
          );
        }

        setPhase("done");
        router.push(`/jobs/${createdId}`);
      } catch (caught) {
        setError(friendlyError(caught));
        setPhase("idle");
      }
    },
    [
      amountWei,
      briefHash,
      canSubmit,
      dayCount,
      escrowAddress,
      provider,
      publicClient,
      router,
      title,
      brief,
      writeContractAsync,
    ],
  );

  const busy = phase !== "idle" && phase !== "done";

  return (
    <form onSubmit={submit} className="grid-2" style={{ alignItems: "start", gap: "var(--s6)" }}>
      <div>
        <label className="field">
          <span className="label">Job title (optional)</span>
          <input
            className="input"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={120}
            placeholder="Competitor summary, Q3"
            disabled={busy}
          />
          <p className="hint">Shown on the outcome page. Kept off-chain.</p>
        </label>

        <label className="field">
          <span className="label">Provider wallet</span>
          <input
            className="input mono"
            value={provider}
            onChange={(event) => setProvider(event.target.value)}
            placeholder="0x…"
            spellCheck={false}
            disabled={busy}
          />
          {provider.trim().length > 0 && !providerValid && (
            <p className="hint" style={{ color: "var(--stop)" }}>
              That is not a valid address.
            </p>
          )}
          {selfDeal && (
            <p className="hint" style={{ color: "var(--stop)" }}>
              The provider cannot be your own wallet.
            </p>
          )}
          {providerValid && !selfDeal && (
            <p className="hint">This address, and only this address, can submit the delivery.</p>
          )}
        </label>

        <div className="grid-2" style={{ gap: "var(--s4)" }}>
          <label className="field">
            <span className="label">Amount (BOT)</span>
            <input
              className="input mono"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              placeholder="1.0"
              inputMode="decimal"
              disabled={busy}
            />
            {amount.trim().length > 0 && amountWei === null && (
              <p className="hint" style={{ color: "var(--stop)" }}>
                Enter a positive amount.
              </p>
            )}
          </label>

          <label className="field">
            <span className="label">Deadline (days)</span>
            <input
              className="input mono"
              value={days}
              onChange={(event) => setDays(event.target.value)}
              inputMode="numeric"
              disabled={busy}
            />
            {!validDays && (
              <p className="hint" style={{ color: "var(--stop)" }}>
                1 to {MAX_WINDOW_DAYS} days.
              </p>
            )}
          </label>
        </div>

        <button type="submit" className="btn btn-block" disabled={!canSubmit || busy}>
          {busy && <span className="spinner" aria-hidden="true" />}
          {phase === "signing" && "Confirm in wallet…"}
          {phase === "confirming" && "Waiting for confirmation…"}
          {phase === "storing" && "Saving brief…"}
          {(phase === "idle" || phase === "done") &&
            (amountWei ? `Escrow ${amount.trim()} BOT` : "Escrow funds")}
        </button>

        {!isConnected && (
          <p className="hint" style={{ marginTop: "var(--s3)" }}>
            Connect a wallet to create a job.
          </p>
        )}
        {wrongChain && (
          <p className="hint" style={{ marginTop: "var(--s3)", color: "var(--accent)" }}>
            Switch your wallet to BOT Chain (id {PUBLIC_CONFIG.chainId}) first.
          </p>
        )}

        {txHash && (
          <p className="hint" style={{ marginTop: "var(--s3)" }}>
            Transaction{" "}
            <a className="mono" href={txUrl(txHash)} target="_blank" rel="noopener noreferrer">
              {txHash.slice(0, 12)}…
            </a>
            {jobId && ` · job #${jobId}`}
          </p>
        )}

        {error && (
          <div style={{ marginTop: "var(--s4)" }}>
            <Notice tone="error">{error}</Notice>
          </div>
        )}
      </div>

      <div>
        <label className="field">
          <span className="label">
            Brief
            <span className={`counter ${brief.length > MAX_BRIEF_CHARS ? "over" : ""}`}>
              {brief.length.toLocaleString()} / {MAX_BRIEF_CHARS.toLocaleString()}
            </span>
          </span>
          <textarea
            className="textarea"
            value={brief}
            onChange={(event) => setBrief(event.target.value)}
            placeholder={
              "State the deliverable, the format, and what would make it unacceptable.\n\nThe verification agent is given this text verbatim, so anything you leave implicit it cannot check."
            }
            disabled={busy}
          />
          <p className="hint">
            Your brief is not published on the blockchain — only a fingerprint of it is. That is
            enough to prove later that nobody edited it, without making what you wrote public.
          </p>
        </label>

        <div className="panel">
          <span className="label">Brief hash</span>
          {briefHash ? (
            <span className="hash">
              <code className="mono">{briefHash}</code>
              <CopyButton value={briefHash} />
            </span>
          ) : (
            <span className="muted small">Type a brief to see its hash.</span>
          )}
        </div>

        <div style={{ marginTop: "var(--s4)" }}>
          <Notice tone="warn">
            Funds are locked as soon as this transaction confirms. They can only leave escrow via a
            signed verdict, your own decision on a CAUTION, or a refund after the deadline passes
            with no delivery.
          </Notice>
        </div>
      </div>
    </form>
  );
}
