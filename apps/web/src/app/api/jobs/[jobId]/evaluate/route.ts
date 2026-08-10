/**
 * POST /api/jobs/:jobId/evaluate — run the verifier. Internal only.
 *
 * Guarded by `INTERNAL_API_SECRET` because it spends model credits and mints a signature. The
 * public path to a verdict is GET /api/jobs/:jobId; this endpoint exists for the watcher, the
 * chain webhook, and an operator re-running a job by hand.
 */

import { authorizeInternal, fail, ok, parseJobId } from "@/lib/api";
import { evaluateJob } from "@/lib/evaluation-service";
import { HashMismatchError, DeliveryTooLargeError } from "@botlatch/verifier";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request, context: { params: Promise<{ jobId: string }> }) {
  const auth = authorizeInternal(request);
  if (!auth.ok) return auth.response;

  const { jobId: raw } = await context.params;
  const jobId = parseJobId(raw);
  if (!jobId) return fail(400, "Invalid job id.");

  const force = new URL(request.url).searchParams.get("force") === "1";

  try {
    const outcome = await evaluateJob(jobId, { force });

    if (outcome.status === "skipped") return ok({ status: "skipped", reason: outcome.reason });
    if (outcome.status === "already-evaluated") {
      return ok({ status: "already-evaluated", verdict: outcome.record.verdict });
    }

    return ok({
      status: "evaluated",
      verdict: outcome.record.verdict,
      evidenceHash: outcome.record.evidenceHash,
      conformanceScore: outcome.record.conformanceScore,
      safetyScore: outcome.record.safetyScore,
      reasons: outcome.record.reasons,
      patternHits: outcome.record.patternHits,
    });
  } catch (error) {
    if (error instanceof HashMismatchError) {
      return fail(409, "Stored content does not match the on-chain commitments.", error.message);
    }
    if (error instanceof DeliveryTooLargeError) {
      return fail(413, "The delivery exceeds the size the verifier will accept.", error.message);
    }
    console.error(`[botlatch] evaluate failed for job ${raw}:`, error);
    return fail(500, "Evaluation failed.");
  }
}
