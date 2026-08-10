/**
 * Server-side chain reads.
 *
 * Every API route that makes a claim about a job reads it from the contract rather than trusting
 * the database. The database can be wrong or stale; the escrow cannot.
 */

import "server-only";
import { createPublicClient, http, type Address, type Hex, type PublicClient } from "viem";
import { AGENT_WORK_ESCROW_ABI } from "./abi";
import { botChain } from "./chain";
import { chainId, escrowAddress, rpcUrl } from "./server-env";

let client: PublicClient | null = null;

export function publicClient(): PublicClient {
  client ??= createPublicClient({
    chain: { ...botChain, id: chainId() },
    transport: http(rpcUrl(), { batch: true, retryCount: 2 }),
  }) as PublicClient;
  return client;
}

export interface OnChainJob {
  buyer: Address;
  createdAt: bigint;
  status: number;
  verdict: number;
  provider: Address;
  deliverBy: bigint;
  amount: bigint;
  briefHash: Hex;
  deliveryHash: Hex;
}

/** Reads a job from the escrow. Returns null when the contract reverts with `UnknownJob`. */
export async function readJob(jobId: bigint): Promise<OnChainJob | null> {
  try {
    const job = await publicClient().readContract({
      address: escrowAddress() as Address,
      abi: AGENT_WORK_ESCROW_ABI,
      functionName: "getJob",
      args: [jobId],
    });
    return {
      buyer: job.buyer,
      createdAt: BigInt(job.createdAt),
      status: Number(job.status),
      verdict: Number(job.verdict),
      provider: job.provider,
      deliverBy: BigInt(job.deliverBy),
      amount: BigInt(job.amount),
      briefHash: job.briefHash,
      deliveryHash: job.deliveryHash,
    };
  } catch {
    // getJob reverts for an id that was never created. Any other RPC failure also lands here and
    // is treated the same way: we do not know about this job, so we say nothing about it.
    return null;
  }
}

export async function readVerifierSigner(): Promise<Address> {
  return publicClient().readContract({
    address: escrowAddress() as Address,
    abi: AGENT_WORK_ESCROW_ABI,
    functionName: "verifierSigner",
  });
}

export async function readJobCount(): Promise<bigint> {
  return publicClient().readContract({
    address: escrowAddress() as Address,
    abi: AGENT_WORK_ESCROW_ABI,
    functionName: "jobCount",
  });
}
