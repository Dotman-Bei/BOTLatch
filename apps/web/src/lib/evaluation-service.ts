/**
 * Evaluation service.
 *
 * One code path, three callers: the internal evaluate route, the delivery upload route, and the
 * chain watcher. Centralising it keeps the security preconditions in a single place — a delivery
 * is only ever evaluated when the escrow says it exists, is in `Delivered`, has no verdict yet,
 * and commits to exactly the bytes we are about to send the model.
 */

import "server-only";
import type { Address, Hex } from "viem";
import { assertHashesMatch, verifyDelivery, type VerificationResult } from "@botlatch/verifier";
import { readJob } from "./chain-server";
import { chainId, escrowAddress, verifierPrivateKey } from "./server-env";
import { getStore, type EvaluationRecord, type JobKey } from "./store";

export type EvaluateOutcome =
  | { status: "evaluated"; record: EvaluationRecord; result: VerificationResult }
  | { status: "already-evaluated"; record: EvaluationRecord }
  | { status: "skipped"; reason: string };

export function jobKeyFor(jobId: bigint): JobKey {
  return { chainId: chainId(), contractAddress: escrowAddress(), jobId: jobId.toString() };
}

/**
 * Evaluate the stored delivery for `jobId` and persist the verdict.
 *
 * Idempotent by delivery hash: re-running is a no-op unless the provider has re-delivered (which
 * the contract permits until a verdict lands) or `force` is set. Never throws for an ordinary
 * "not ready yet" condition — those come back as `skipped` so a watcher tick can move on.
 */
export async function evaluateJob(
  jobId: bigint,
  options: { force?: boolean } = {},
): Promise<EvaluateOutcome> {
  const store = getStore();
  const key = jobKeyFor(jobId);

  const onChain = await readJob(jobId);
  if (!onChain) return { status: "skipped", reason: "Job does not exist on-chain." };
  if (onChain.status !== 2) {
    return { status: "skipped", reason: "Job is not awaiting verification." };
  }
  if (onChain.verdict !== 0) {
    return { status: "skipped", reason: "A verdict has already been applied on-chain." };
  }

  const record = await store.getJob(key);
  if (!record) return { status: "skipped", reason: "No stored brief for this job." };
  if (!record.delivery) return { status: "skipped", reason: "The delivery text has not been uploaded yet." };

  const existing = await store.getEvaluation(key);
  if (existing && !options.force && existing.deliveryHash.toLowerCase() === onChain.deliveryHash.toLowerCase()) {
    return { status: "already-evaluated", record: existing };
  }

  // The content we are about to sign over must be exactly what buyer and provider committed to.
  // A mismatch means the database and the chain disagree; refuse rather than sign either version.
  assertHashesMatch(record.brief, record.delivery, {
    briefHash: onChain.briefHash,
    deliveryHash: onChain.deliveryHash,
  });

  const result = await verifyDelivery({
    jobId,
    chainId: key.chainId,
    escrowAddress: key.contractAddress as Address,
    brief: record.brief,
    delivery: record.delivery,
    verifierPrivateKey: verifierPrivateKey(),
  });

  const evaluation: EvaluationRecord = {
    jobId: key.jobId,
    chainId: key.chainId,
    contractAddress: key.contractAddress,
    deliveryHash: onChain.deliveryHash,
    verdict: result.evaluation.verdict,
    conformanceScore: result.evaluation.conformanceScore,
    safetyScore: result.evaluation.safetyScore,
    reasons: result.evaluation.reasons,
    patternHits: result.evaluation.patternHits,
    evidence: result.evidence,
    evidenceHash: result.evidenceHash,
    verifierAddress: result.signed.verifierAddress as Hex,
    createdAt: new Date().toISOString(),
  };

  await store.putEvaluation(evaluation);
  return { status: "evaluated", record: evaluation, result };
}
