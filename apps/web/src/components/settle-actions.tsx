"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import type { Hex } from "viem";
import { useAccount, usePublicClient, useWriteContract } from "wagmi";
import { Notice } from "@/components/ui";
import type { JobPayload } from "@/components/use-job";
import { AGENT_WORK_ESCROW_ABI } from "@/lib/abi";
import { txUrl } from "@/lib/chain";
import { PUBLIC_CONFIG } from "@/lib/config";
import { friendlyError, isExpired, sameAddress } from "@/lib/format";

interface DecisionResponse {
  decision: {
    jobId: string;
    briefHash: Hex;
    deliveryHash: Hex;
    evidenceHash: Hex;
    verdict: number;
    validUntil: string;
  };
  signature: Hex;
  verifierAddress: Hex;
  verdict: string;
  expiresAt: number;
}

type Pending = null | "settle" | "release" | "refund" | "cancel";

/**
 * The action rail on the outcome page.
 *
 * Which buttons exist is derived from on-chain state, not from what the viewer would like to do:
 *
 *   - Delivered + no verdict + a stored evaluation → anyone may `settle`. The signature is the
 *     authority, so a relayer or either party can push it; whoever pays gas, the outcome is fixed.
 *   - Delivered + CAUTION → only the buyer, and only they see Release / Refund.
 *   - Funded + past the deadline → only the buyer, `cancelExpired`.
 *
 * Everything else renders as read-only state.
 */
export function SettleActions({
  jobId,
  escrowAddress,
  data,
}: {
  jobId: string;
  escrowAddress: Hex;
  data: JobPayload;
}) {
  const { address, isConnected, chainId } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const queryClient = useQueryClient();

  const [pending, setPending] = useState<Pending>(null);
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<Hex | null>(null);

  const { job, evaluation } = data;
  const isBuyer = sameAddress(address, job.buyer);
  const wrongChain = isConnected && chainId !== PUBLIC_CONFIG.chainId;

  const awaitingSettlement = job.statusCode === 2 && job.verdictCode === 0;
  const cautionOpen = job.statusCode === 2 && job.verdictCode === 2;
  const cancellable = job.statusCode === 1 && isExpired(job.deliverBy);

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ["job", jobId] });
  }, [jobId, queryClient]);

  const run = useCallback(
    async (kind: Exclude<Pending, null>, send: () => Promise<Hex>) => {
      setError(null);
      setPending(kind);
      setTxHash(null);
      try {
        const hash = await send();
        setTxHash(hash);
        const receipt = await publicClient?.waitForTransactionReceipt({ hash });
        if (receipt && receipt.status !== "success") {
          throw new Error("The transaction reverted. Nothing changed on-chain.");
        }
        await refresh();
      } catch (caught) {
        setError(friendlyError(caught));
      } finally {
        setPending(null);
      }
    },
    [publicClient, refresh],
  );

  const settle = useCallback(
    () =>
      run("settle", async () => {
        // Always fetch a fresh signature: the contract rejects decisions older than an hour, and a
        // page left open overnight would otherwise submit an expired one and revert.
        const response = await fetch(`/api/jobs/${jobId}/decision`, { method: "POST" });
        if (!response.ok) {
          const detail = (await response.json().catch(() => null)) as { error?: string } | null;
          throw new Error(detail?.error ?? `Could not fetch the decision (${response.status}).`);
        }
        const payload = (await response.json()) as DecisionResponse;

        return writeContractAsync({
          address: escrowAddress,
          abi: AGENT_WORK_ESCROW_ABI,
          functionName: "settle",
          args: [
            {
              jobId: BigInt(payload.decision.jobId),
              briefHash: payload.decision.briefHash,
              deliveryHash: payload.decision.deliveryHash,
              evidenceHash: payload.decision.evidenceHash,
              verdict: payload.decision.verdict,
              validUntil: BigInt(payload.decision.validUntil),
            },
            payload.signature,
          ],
        });
      }),
    [escrowAddress, jobId, run, writeContractAsync],
  );

  const resolve = useCallback(
    (release: boolean) =>
      run(release ? "release" : "refund", () =>
        writeContractAsync({
          address: escrowAddress,
          abi: AGENT_WORK_ESCROW_ABI,
          functionName: "resolveCaution",
          args: [BigInt(jobId), release],
        }),
      ),
    [escrowAddress, jobId, run, writeContractAsync],
  );

  const cancel = useCallback(
    () =>
      run("cancel", () =>
        writeContractAsync({
          address: escrowAddress,
          abi: AGENT_WORK_ESCROW_ABI,
          functionName: "cancelExpired",
          args: [BigInt(jobId)],
        }),
      ),
    [escrowAddress, jobId, run, writeContractAsync],
  );

  const busy = pending !== null;

  let body: React.ReactNode = null;

  if (awaitingSettlement && evaluation) {
    body = (
      <>
        <p className="dim small">
          The verifier signed a <strong>{evaluation.verdict}</strong> decision. Submitting it applies
          the verdict on-chain
          {evaluation.verdict === "GO" && " and releases the payment to the provider"}
          {evaluation.verdict === "NO_GO" && " and refunds the buyer in full"}
          {evaluation.verdict === "CAUTION" && ", which holds the funds and hands the call to the buyer"}
          . Anyone can submit it — the signature decides the outcome, not the sender.
        </p>
        <button type="button" className="btn" onClick={settle} disabled={!isConnected || wrongChain || busy}>
          {pending === "settle" && <span className="spinner" aria-hidden="true" />}
          {pending === "settle" ? "Settling…" : "Apply decision on-chain"}
        </button>
      </>
    );
  } else if (awaitingSettlement && !evaluation) {
    body = (
      <p className="row dim small">
        <span className="spinner" aria-hidden="true" />
        The verification agent is reviewing the delivery. This page updates itself when the verdict
        lands.
      </p>
    );
  } else if (cautionOpen) {
    body = isBuyer ? (
      <>
        <p className="dim small">
          The verifier could not clear this automatically, so the funds are still locked and the
          decision is yours. Read the reasons above before choosing — both actions are final.
        </p>
        <div className="row">
          <button type="button" className="btn" onClick={() => resolve(true)} disabled={wrongChain || busy}>
            {pending === "release" && <span className="spinner" aria-hidden="true" />}
            {pending === "release" ? "Releasing…" : "Release payment"}
          </button>
          <button
            type="button"
            className="btn btn-danger"
            onClick={() => resolve(false)}
            disabled={wrongChain || busy}
          >
            {pending === "refund" && <span className="spinner" aria-hidden="true" />}
            {pending === "refund" ? "Refunding…" : "Refund buyer"}
          </button>
        </div>
      </>
    ) : (
      <p className="dim small">
        Funds are held pending the buyer's decision. Only the buyer's wallet can release or refund a
        CAUTION.
      </p>
    );
  } else if (cancellable) {
    body = isBuyer ? (
      <>
        <p className="dim small">
          The deadline passed with no delivery. You can reclaim the full escrowed amount.
        </p>
        <button type="button" className="btn" onClick={cancel} disabled={wrongChain || busy}>
          {pending === "cancel" && <span className="spinner" aria-hidden="true" />}
          {pending === "cancel" ? "Cancelling…" : "Cancel and refund"}
        </button>
      </>
    ) : (
      <p className="dim small">
        The deadline has passed with no delivery. The buyer can reclaim the escrowed funds.
      </p>
    );
  } else if (job.statusCode === 1) {
    body = <p className="dim small">Funds are escrowed. Waiting for the provider to deliver.</p>;
  } else if (job.statusCode === 3) {
    body = <p className="dim small">Settled. The funds have left escrow; nothing further can be done.</p>;
  } else if (job.statusCode === 4) {
    body = <p className="dim small">Cancelled. The buyer was refunded in full.</p>;
  }

  if (!body) return null;

  return (
    <section className="panel">
      <h4 style={{ marginBottom: "var(--s4)" }}>Settlement</h4>
      {body}

      {!isConnected && (awaitingSettlement || cautionOpen || cancellable) && (
        <p className="hint" style={{ marginTop: "var(--s3)" }}>
          Connect a wallet to act on this job.
        </p>
      )}
      {wrongChain && (
        <p className="hint" style={{ marginTop: "var(--s3)", color: "var(--accent)" }}>
          Switch your wallet to BOT Chain (id {PUBLIC_CONFIG.chainId}) first.
        </p>
      )}
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
    </section>
  );
}
