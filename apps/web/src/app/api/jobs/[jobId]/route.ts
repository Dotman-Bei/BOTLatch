/**
 * GET /api/jobs/:jobId — public job state plus the scrubbed evidence behind its verdict.
 *
 * On-chain state is authoritative and always read live; the database only fills in the brief,
 * the title and the transaction hashes. A job that exists on-chain but has no stored brief still
 * returns successfully — it is a real job, just one this deployment has no content for.
 *
 * This route also heals a missed evaluation. The upload route starts one in the background and
 * does not wait for it, which is right for the provider but unreliable in practice: a serverless
 * function is frozen the moment it returns a response, so that background call is killed before
 * the model answers. The chain watcher is the durable backstop, but it only runs as often as
 * whatever schedules it, so a buyer refreshing the outcome page would sit on "verifying" until the
 * next tick. Since the page polls this endpoint anyway, the first poll after a delivery does the
 * work inside a live request, where nothing can freeze it.
 */

import { clientKey, fail, ok, parseJobId, rateLimit, tooManyRequests } from "@/lib/api";
import { readJob } from "@/lib/chain-server";
import { evaluateJob } from "@/lib/evaluation-service";
import { toPublicEvaluation, toPublicJob } from "@/lib/public-view";
import { chainId, escrowAddress } from "@/lib/server-env";
import { getStore } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Long enough for one model call plus the chain reads around it. The verifier's own timeout
// (LLM_TIMEOUT_MS, 20s by default) fires well before this, so the ceiling here is a backstop
// against a hung socket rather than the normal path.
export const maxDuration = 60;

export async function GET(request: Request, context: { params: Promise<{ jobId: string }> }) {
  const limit = rateLimit(clientKey(request, "jobs:read"), 120, 60_000);
  if (!limit.allowed) return tooManyRequests(limit.retryAfterSeconds);

  const { jobId: raw } = await context.params;
  const jobId = parseJobId(raw);
  if (!jobId) return fail(400, "Invalid job id.");

  let onChain;
  try {
    onChain = await readJob(jobId);
  } catch {
    return fail(503, "Could not reach the chain.");
  }
  if (!onChain) return fail(404, "No such job.");

  const key = { chainId: chainId(), contractAddress: escrowAddress(), jobId: jobId.toString() };
  const store = getStore();
  let [record, evaluation] = await Promise.all([store.getJob(key), store.getEvaluation(key)]);

  // Delivered, no verdict on-chain, nothing stored: the background evaluation never landed.
  // `evaluateJob` re-reads the chain and is idempotent by delivery hash, so concurrent polls
  // converge on one result rather than racing. A failure here must not fail the read — the caller
  // still gets the job, and the watcher will try again.
  if (onChain.status === 2 && onChain.verdict === 0 && !evaluation && record?.delivery) {
    try {
      const outcome = await evaluateJob(jobId);
      if (outcome.status === "evaluated" || outcome.status === "already-evaluated") {
        evaluation = outcome.record;
      }
    } catch (error) {
      console.error(`[botlatch] inline evaluation failed for job ${key.jobId}:`, error);
    }
  }

  return ok({
    job: toPublicJob(key.jobId, key.chainId, key.contractAddress, onChain, record),
    evaluation: evaluation
      ? toPublicEvaluation(
          evaluation,
          onChain.deliveryHash === `0x${"0".repeat(64)}` ? null : onChain.deliveryHash,
        )
      : null,
  });
}
