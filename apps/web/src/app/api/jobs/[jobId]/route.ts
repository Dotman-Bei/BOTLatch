/**
 * GET /api/jobs/:jobId — public job state plus the scrubbed evidence behind its verdict.
 *
 * On-chain state is authoritative and always read live; the database only fills in the brief,
 * the title and the transaction hashes. A job that exists on-chain but has no stored brief still
 * returns successfully — it is a real job, just one this deployment has no content for.
 */

import { clientKey, fail, ok, parseJobId, rateLimit, tooManyRequests } from "@/lib/api";
import { readJob } from "@/lib/chain-server";
import { toPublicEvaluation, toPublicJob } from "@/lib/public-view";
import { chainId, escrowAddress } from "@/lib/server-env";
import { getStore } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
  const [record, evaluation] = await Promise.all([store.getJob(key), store.getEvaluation(key)]);

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
