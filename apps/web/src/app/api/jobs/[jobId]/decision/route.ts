/**
 * POST /api/jobs/:jobId/decision — hand out a settlement-ready signed decision.
 *
 * The verdict itself is *not* recomputed here. It was decided once, when the delivery was
 * evaluated, and stored with its evidence. What this route does is mint a fresh EIP-712 signature
 * over that stored decision, because the contract rejects anything older than an hour
 * (`MAX_DECISION_TTL`) and a demo can easily outlive that.
 *
 * Re-signing is safe precisely because every field is pinned: job id, brief hash, delivery hash,
 * evidence hash and verdict all come from storage and are re-checked against the chain first. The
 * only thing that changes between two calls is `validUntil`. If the provider has re-delivered
 * since, the hashes no longer agree and the route refuses instead of signing a verdict about text
 * nobody is offering any more.
 *
 * Public but rate-limited: the signature authorises exactly one settlement of one job to addresses
 * fixed at job creation, so handing it to a stranger changes nothing about who gets paid.
 */

import {
  hashEvidence,
  signDecision,
  type Evidence,
  type Verdict,
} from "@botlatch/verifier";
import type { Address } from "viem";
import { clientKey, fail, ok, parseJobId, rateLimit, tooManyRequests } from "@/lib/api";
import { readJob } from "@/lib/chain-server";
import { chainId, escrowAddress, hasVerifierKey, verifierPrivateKey } from "@/lib/server-env";
import { getStore } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ jobId: string }> }) {
  const limit = rateLimit(clientKey(request, "jobs:decision"), 30, 60_000);
  if (!limit.allowed) return tooManyRequests(limit.retryAfterSeconds);

  const { jobId: raw } = await context.params;
  const jobId = parseJobId(raw);
  if (!jobId) return fail(400, "Invalid job id.");

  if (!hasVerifierKey()) return fail(503, "The verifier signing key is not configured.");

  const onChain = await readJob(jobId);
  if (!onChain) return fail(404, "No such job.");
  if (onChain.status !== 2) return fail(409, "This job is not awaiting settlement.");
  if (onChain.verdict !== 0) return fail(409, "A verdict has already been applied to this job.");

  const key = { chainId: chainId(), contractAddress: escrowAddress(), jobId: jobId.toString() };
  const evaluation = await getStore().getEvaluation(key);
  if (!evaluation) return fail(404, "This delivery has not been verified yet.");

  if (evaluation.deliveryHash.toLowerCase() !== onChain.deliveryHash.toLowerCase()) {
    return fail(
      409,
      "The stored verdict is about a different delivery. The job needs re-verification.",
    );
  }

  // Re-derive the evidence hash from the stored evidence rather than trusting the stored hash.
  // If the two ever disagree, the record has been tampered with and must not be signed over.
  const recomputed = hashEvidence(evaluation.evidence as Evidence);
  if (recomputed.toLowerCase() !== evaluation.evidenceHash.toLowerCase()) {
    return fail(500, "Stored evidence does not match its hash.");
  }

  const signed = await signDecision({
    privateKey: verifierPrivateKey(),
    chainId: key.chainId,
    escrowAddress: key.contractAddress as Address,
    jobId,
    briefHash: onChain.briefHash,
    deliveryHash: onChain.deliveryHash,
    evidenceHash: evaluation.evidenceHash,
    verdict: evaluation.verdict as Verdict,
  });

  return ok({
    decision: signed.decisionJson,
    signature: signed.signature,
    verifierAddress: signed.verifierAddress,
    verdict: evaluation.verdict,
    reasons: evaluation.reasons,
    evidenceHash: evaluation.evidenceHash,
    expiresAt: Number(signed.decision.validUntil),
  });
}
