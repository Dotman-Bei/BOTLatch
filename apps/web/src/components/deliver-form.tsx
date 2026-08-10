"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { keccak256, toBytes, type Hex } from "viem";
import { useAccount, usePublicClient, useSignMessage, useWriteContract } from "wagmi";
import { CopyButton } from "@/components/copy-button";
import { useJob } from "@/components/use-job";
import { AddressValue, HashValue, Notice } from "@/components/ui";
import { AGENT_WORK_ESCROW_ABI } from "@/lib/abi";
import { txUrl } from "@/lib/chain";
import { MAX_DELIVERY_CHARS, MIN_DELIVERY_CHARS, PUBLIC_CONFIG } from "@/lib/config";
import { deliveryAuthMessage } from "@/lib/delivery-auth";
import { formatBot, formatRelative, friendlyError, isExpired, sameAddress } from "@/lib/format";

type Phase = "idle" | "signing-tx" | "confirming" | "signing-auth" | "uploading" | "done";

export function DeliverForm({ jobId, escrowAddress }: { jobId: string; escrowAddress: Hex }) {
  const router = useRouter();
  const { address, isConnected, chainId } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const { signMessageAsync } = useSignMessage();
  const { data, isLoading, error: loadError } = useJob(jobId);

  const [delivery, setDelivery] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<Hex | null>(null);

  const deliveryHash = useMemo(
    () => (delivery.length > 0 ? keccak256(toBytes(delivery)) : null),
    [delivery],
  );

  const job = data?.job;
  const isProvider = sameAddress(address, job?.provider);
  const wrongChain = isConnected && chainId !== PUBLIC_CONFIG.chainId;
  const lengthOk =
    delivery.length >= MIN_DELIVERY_CHARS && delivery.length <= MAX_DELIVERY_CHARS;
  const expired = job ? isExpired(job.deliverBy) : false;

  const canSubmit =
    Boolean(job) &&
    job?.statusCode === 1 &&
    isConnected &&
    !wrongChain &&
    isProvider &&
    lengthOk &&
    !expired &&
    phase === "idle";

  const submit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      if (!canSubmit || !deliveryHash || !publicClient || !job) return;

      setError(null);
      setPhase("signing-tx");

      try {
        // 1. Commit the hash on-chain. This is the step that changes the job's state and starts
        //    verification; the upload that follows only supplies the text behind the hash.
        const hash = await writeContractAsync({
          address: escrowAddress,
          abi: AGENT_WORK_ESCROW_ABI,
          functionName: "submitDelivery",
          args: [BigInt(jobId), deliveryHash],
        });
        setTxHash(hash);
        setPhase("confirming");

        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        if (receipt.status !== "success") {
          throw new Error("The transaction reverted. Nothing was submitted.");
        }

        // 2. Prove to the app that this upload comes from the provider wallet.
        setPhase("signing-auth");
        const signature = await signMessageAsync({
          message: deliveryAuthMessage({
            chainId: PUBLIC_CONFIG.chainId,
            contractAddress: escrowAddress,
            jobId,
            deliveryHash,
          }),
        });

        // 3. Hand over the text. Verification is queued server-side from here.
        setPhase("uploading");
        const response = await fetch(`/api/jobs/${jobId}/delivery`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ delivery, signature, txHash: hash }),
        });
        if (!response.ok) {
          const detail = (await response.json().catch(() => null)) as { error?: string } | null;
          throw new Error(
            `The hash is on-chain, but the text could not be stored: ${
              detail?.error ?? response.statusText
            } Retry from this page — the hash must match exactly.`,
          );
        }

        setPhase("done");
        router.push(`/jobs/${jobId}`);
      } catch (caught) {
        setError(friendlyError(caught));
        setPhase("idle");
      }
    },
    [
      canSubmit,
      delivery,
      deliveryHash,
      escrowAddress,
      job,
      jobId,
      publicClient,
      router,
      signMessageAsync,
      writeContractAsync,
    ],
  );

  if (isLoading) {
    return (
      <p className="row muted">
        <span className="spinner" aria-hidden="true" /> Loading job #{jobId}…
      </p>
    );
  }

  if (loadError || !job) {
    return <Notice tone="error">{loadError ? friendlyError(loadError) : "Job not found."}</Notice>;
  }

  const busy = phase !== "idle" && phase !== "done";

  return (
    <>
      <div className="panel" style={{ marginBottom: "var(--s6)" }}>
        <dl className="data-list">
          <div className="data-row">
            <dt>Payment</dt>
            <dd className="mono" style={{ fontSize: "var(--step-1)", color: "var(--accent)" }}>
              {formatBot(job.amountWei)}
            </dd>
          </div>
          <div className="data-row">
            <dt>Buyer</dt>
            <dd>
              <AddressValue value={job.buyer} />
            </dd>
          </div>
          <div className="data-row">
            <dt>Provider</dt>
            <dd>
              <AddressValue value={job.provider} note={isProvider ? "you" : undefined} />
            </dd>
          </div>
          <div className="data-row">
            <dt>Deadline</dt>
            <dd className={expired ? "" : "dim"} style={expired ? { color: "var(--stop)" } : undefined}>
              {formatRelative(job.deliverBy)}
              {expired && " · expired"}
            </dd>
          </div>
          <div className="data-row">
            <dt>Brief hash</dt>
            <dd>
              <HashValue value={job.briefHash} />
            </dd>
          </div>
        </dl>
      </div>

      {job.brief ? (
        <section style={{ marginBottom: "var(--s6)" }}>
          <div className="row-between" style={{ marginBottom: "var(--s3)" }}>
            <h4>The brief</h4>
            <CopyButton value={job.brief} label="Copy brief" />
          </div>
          <div className="card card-static">
            <p className="dim" style={{ whiteSpace: "pre-wrap", margin: 0 }}>
              {job.brief}
            </p>
          </div>
        </section>
      ) : (
        <div style={{ marginBottom: "var(--s6)" }}>
          <Notice tone="warn">
            The brief text was never stored with this deployment — only its hash is on-chain. Ask the
            buyer for it. Verification cannot run without it.
          </Notice>
        </div>
      )}

      {job.statusCode !== 1 ? (
        <Notice tone={job.statusCode === 0 ? "error" : "warn"}>
          {job.statusCode === 2 && (
            <>
              A delivery has already been submitted for this job.{" "}
              <Link href={`/jobs/${jobId}`}>See the outcome</Link>.
            </>
          )}
          {job.statusCode === 3 && (
            <>
              This job is settled. <Link href={`/jobs/${jobId}`}>See the outcome</Link>.
            </>
          )}
          {job.statusCode === 4 && "This job was cancelled after its deadline and the buyer refunded."}
          {job.statusCode === 0 && "This job does not exist on the escrow."}
        </Notice>
      ) : (
        <form onSubmit={submit}>
          <label className="field">
            <span className="label">
              Your delivery
              <span
                className={`counter ${delivery.length > MAX_DELIVERY_CHARS ? "over" : ""}`}
              >
                {delivery.length.toLocaleString()} / {MAX_DELIVERY_CHARS.toLocaleString()}
              </span>
            </span>
            <textarea
              className="textarea"
              style={{ minHeight: 320 }}
              value={delivery}
              onChange={(event) => setDelivery(event.target.value)}
              placeholder="Paste the finished work. Answer the brief directly — the verification agent scores this text against it, and sees nothing else."
              disabled={busy || !isProvider}
              spellCheck={false}
            />
            <p className="hint">
              Between {MIN_DELIVERY_CHARS} and {MAX_DELIVERY_CHARS.toLocaleString()} characters. Only
              the hash goes on-chain; the text is stored off-chain for verification and is never shown
              to the public.
            </p>
          </label>

          <div className="panel" style={{ marginBottom: "var(--s5)" }}>
            <span className="label">Delivery hash</span>
            {deliveryHash ? (
              <span className="hash">
                <code className="mono">{deliveryHash}</code>
                <CopyButton value={deliveryHash} />
              </span>
            ) : (
              <span className="muted small">Paste your work to see its hash.</span>
            )}
          </div>

          {!isConnected && <Notice tone="warn">Connect the provider wallet to submit.</Notice>}
          {isConnected && !isProvider && (
            <Notice tone="error">
              This job is assigned to a different provider. Connect the wallet the buyer named, or
              ask them to create a job for the address you control.
            </Notice>
          )}
          {wrongChain && (
            <Notice tone="warn">
              Switch your wallet to BOT Chain (id {PUBLIC_CONFIG.chainId}) to submit.
            </Notice>
          )}
          {expired && (
            <Notice tone="error">
              The deadline has passed. The buyer can now cancel and take the funds back — submitting
              is likely to fail.
            </Notice>
          )}

          <button
            type="submit"
            className="btn btn-block"
            style={{ marginTop: "var(--s5)" }}
            disabled={!canSubmit || busy}
          >
            {busy && <span className="spinner" aria-hidden="true" />}
            {phase === "signing-tx" && "Confirm in wallet…"}
            {phase === "confirming" && "Waiting for confirmation…"}
            {phase === "signing-auth" && "Sign the upload…"}
            {phase === "uploading" && "Uploading for verification…"}
            {(phase === "idle" || phase === "done") && "Submit delivery"}
          </button>

          <p className="hint" style={{ marginTop: "var(--s3)" }}>
            Two signatures: one transaction that records the hash on-chain, then one free message
            signature that authorises the upload. The second moves no funds.
          </p>

          {txHash && (
            <p className="hint">
              Transaction{" "}
              <a className="mono" href={txUrl(txHash)} target="_blank" rel="noopener noreferrer">
                {txHash.slice(0, 12)}…
              </a>
            </p>
          )}

          {error && (
            <div style={{ marginTop: "var(--s4)" }}>
              <Notice tone="error">{error}</Notice>
            </div>
          )}
        </form>
      )}
    </>
  );
}
