/**
 * POST /api/jobs — persist a brief after `createJob` has confirmed on-chain.
 *
 * Auth is the chain itself, not a session: the job must exist in the escrow, and the brief the
 * client posts must hash to the `briefHash` already committed there. Anyone can therefore submit
 * the brief for a job, but nobody can submit a *different* brief than the one the buyer paid
 * against — which is the property that actually matters.
 */

import { keccak256, toBytes } from "viem";
import { z } from "zod";
import { fail, ok, parseJobId, rateLimit, clientKey, tooManyRequests } from "@/lib/api";
import { readJob } from "@/lib/chain-server";
import { chainId, escrowAddress } from "@/lib/server-env";
import { getStore, type JobRecord } from "@/lib/store";
import { MAX_BRIEF_CHARS } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  jobId: z.string().regex(/^\d{1,78}$/),
  title: z.string().trim().max(120).default(""),
  brief: z.string().min(1).max(MAX_BRIEF_CHARS),
  txHash: z
    .string()
    .regex(/^0x[0-9a-fA-F]{64}$/)
    .optional(),
});

export async function POST(request: Request) {
  const limit = rateLimit(clientKey(request, "jobs:create"), 20, 60_000);
  if (!limit.allowed) return tooManyRequests(limit.retryAfterSeconds);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail(400, "Body must be JSON.");
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) return fail(400, "Invalid request.", parsed.error.flatten());

  const jobId = parseJobId(parsed.data.jobId);
  if (!jobId) return fail(400, "Invalid job id.");

  const onChain = await readJob(jobId);
  if (!onChain) return fail(404, "No such job on-chain. Wait for the transaction to confirm.");

  const computed = keccak256(toBytes(parsed.data.brief));
  if (computed.toLowerCase() !== onChain.briefHash.toLowerCase()) {
    return fail(409, "The brief does not match the hash committed on-chain.");
  }

  const store = getStore();
  const key = { chainId: chainId(), contractAddress: escrowAddress(), jobId: jobId.toString() };
  const existing = await store.getJob(key);

  // First writer wins. The brief is hash-pinned, so a second submission can only be identical
  // text — but overwriting would let a late caller reset the title or the recorded tx hash.
  if (existing) {
    return ok({ jobId: key.jobId, stored: true, alreadyStored: true });
  }

  const now = new Date().toISOString();
  const record: JobRecord = {
    jobId: key.jobId,
    chainId: key.chainId,
    contractAddress: key.contractAddress,
    buyerAddress: onChain.buyer,
    providerAddress: onChain.provider,
    title: parsed.data.title,
    brief: parsed.data.brief,
    briefHash: onChain.briefHash,
    delivery: null,
    deliveryHash: null,
    createdTxHash: (parsed.data.txHash as `0x${string}` | undefined) ?? null,
    deliveryTxHash: null,
    decisionTxHash: null,
    createdAt: now,
    updatedAt: now,
  };

  await store.putJob(record);
  return ok({ jobId: key.jobId, stored: true, alreadyStored: false });
}
