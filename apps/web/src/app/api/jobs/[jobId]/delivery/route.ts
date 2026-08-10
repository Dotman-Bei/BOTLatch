/**
 * POST /api/jobs/:jobId/delivery — store the raw delivery after `submitDelivery` has confirmed.
 *
 * Three independent checks, all required:
 *
 *   1. The escrow says this job is in `Delivered` with no verdict applied.
 *   2. keccak256(delivery) equals the `deliveryHash` committed on-chain.
 *   3. A personal_sign signature over the upload message recovers to the on-chain provider.
 *
 * (2) is what makes the content trustworthy; (3) is what stops strangers writing to our store.
 * Evaluation is then kicked off in the background — the provider's request should not wait on a
 * model call, and a failed evaluation must not look like a failed upload.
 */

import { keccak256, toBytes, verifyMessage, type Hex } from "viem";
import { z } from "zod";
import { clientKey, fail, ok, parseJobId, rateLimit, tooManyRequests } from "@/lib/api";
import { readJob } from "@/lib/chain-server";
import { deliveryAuthMessage } from "@/lib/delivery-auth";
import { evaluateJob } from "@/lib/evaluation-service";
import { chainId, escrowAddress } from "@/lib/server-env";
import { getStore } from "@/lib/store";
import { MAX_DELIVERY_CHARS, MIN_DELIVERY_CHARS } from "@botlatch/verifier";
import {
  MAX_DELIVERY_CHARS as CLIENT_MAX,
  MIN_DELIVERY_CHARS as CLIENT_MIN,
} from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The browser mirrors these bounds so it can show a live counter without bundling the verifier.
// Fail at module load if the copies drift, rather than letting the UI promise a size the server
// will reject.
if (CLIENT_MAX !== MAX_DELIVERY_CHARS || CLIENT_MIN !== MIN_DELIVERY_CHARS) {
  throw new Error(
    `Delivery bounds disagree: config.ts has ${CLIENT_MIN}-${CLIENT_MAX}, ` +
      `@botlatch/verifier has ${MIN_DELIVERY_CHARS}-${MAX_DELIVERY_CHARS}.`,
  );
}

const BodySchema = z.object({
  delivery: z.string().min(1).max(MAX_DELIVERY_CHARS),
  signature: z.string().regex(/^0x[0-9a-fA-F]+$/),
  txHash: z
    .string()
    .regex(/^0x[0-9a-fA-F]{64}$/)
    .optional(),
});

export async function POST(request: Request, context: { params: Promise<{ jobId: string }> }) {
  const limit = rateLimit(clientKey(request, "jobs:delivery"), 10, 60_000);
  if (!limit.allowed) return tooManyRequests(limit.retryAfterSeconds);

  const { jobId: raw } = await context.params;
  const jobId = parseJobId(raw);
  if (!jobId) return fail(400, "Invalid job id.");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail(400, "Body must be JSON.");
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) return fail(400, "Invalid request.", parsed.error.flatten());
  const { delivery, signature } = parsed.data;

  const onChain = await readJob(jobId);
  if (!onChain) return fail(404, "No such job.");
  if (onChain.status !== 2) {
    return fail(409, "This job is not awaiting verification. Submit the delivery on-chain first.");
  }
  if (onChain.verdict !== 0) return fail(409, "A verdict has already been applied to this job.");

  const computed = keccak256(toBytes(delivery));
  if (computed.toLowerCase() !== onChain.deliveryHash.toLowerCase()) {
    return fail(409, "The delivery does not match the hash committed on-chain.");
  }

  const key = { chainId: chainId(), contractAddress: escrowAddress(), jobId: jobId.toString() };
  const message = deliveryAuthMessage({
    chainId: key.chainId,
    contractAddress: key.contractAddress,
    jobId: key.jobId,
    deliveryHash: onChain.deliveryHash,
  });

  let signedByProvider = false;
  try {
    signedByProvider = await verifyMessage({
      address: onChain.provider,
      message,
      signature: signature as Hex,
    });
  } catch {
    signedByProvider = false;
  }
  if (!signedByProvider) {
    return fail(401, "The signature does not come from this job's provider wallet.");
  }

  const store = getStore();
  const record = await store.getJob(key);
  if (!record) {
    return fail(409, "The brief for this job has not been stored, so it cannot be verified yet.");
  }

  await store.updateJob(key, {
    delivery,
    deliveryHash: onChain.deliveryHash,
    deliveryTxHash: (parsed.data.txHash as Hex | undefined) ?? record.deliveryTxHash,
  });

  // Fire and forget. The outcome page polls GET /api/jobs/:jobId for the verdict.
  void evaluateJob(jobId, { force: true }).catch((error: unknown) => {
    console.error(`[botlatch] evaluation failed for job ${key.jobId}:`, error);
  });

  return ok({ stored: true, deliveryHash: onChain.deliveryHash, evaluationQueued: true });
}
