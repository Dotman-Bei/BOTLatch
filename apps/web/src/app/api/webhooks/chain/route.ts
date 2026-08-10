/**
 * POST /api/webhooks/chain — optional indexer hook.
 *
 * An indexer that already watches the escrow can push here instead of waiting for our poller.
 * The body is a hint, never a fact: the job id is used to look up state on-chain, and everything
 * the payload claims about status, hashes or verdicts is ignored. A forged webhook can therefore
 * cause an extra read, nothing more.
 */

import { z } from "zod";
import { authorizeInternal, fail, ok, parseJobId } from "@/lib/api";
import { evaluateJob } from "@/lib/evaluation-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const BodySchema = z.object({
  event: z.string().optional(),
  jobId: z.union([z.string(), z.number()]),
});

export async function POST(request: Request) {
  const auth = authorizeInternal(request);
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail(400, "Body must be JSON.");
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) return fail(400, "Invalid request.", parsed.error.flatten());

  const jobId = parseJobId(String(parsed.data.jobId));
  if (!jobId) return fail(400, "Invalid job id.");

  if (parsed.data.event && parsed.data.event !== "DeliverySubmitted") {
    return ok({ status: "ignored", reason: `No handler for ${parsed.data.event}.` });
  }

  try {
    const outcome = await evaluateJob(jobId);
    return ok(
      outcome.status === "skipped"
        ? { status: "skipped", reason: outcome.reason }
        : { status: outcome.status, verdict: outcome.record.verdict },
    );
  } catch (error) {
    console.error(`[botlatch] webhook evaluation failed for job ${jobId}:`, error);
    return fail(500, "Evaluation failed.");
  }
}
