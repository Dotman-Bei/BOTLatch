/**
 * Storage contract.
 *
 * The escrow is the source of truth for money and state. This layer only holds the content the
 * chain deliberately does not: the raw brief, the raw delivery, and the evidence behind a verdict.
 * Everything here is reconstructible-adjacent — losing it costs auditability and the UI, never
 * custody, because settlement only ever needs hashes the chain already stores.
 */

import type { Hex } from "viem";
import type { Verdict } from "@botlatch/verifier";

export interface JobRecord {
  jobId: string;
  chainId: number;
  contractAddress: Hex;
  buyerAddress: Hex;
  providerAddress: Hex;
  title: string;
  brief: string;
  briefHash: Hex;
  delivery: string | null;
  deliveryHash: Hex | null;
  createdTxHash: Hex | null;
  deliveryTxHash: Hex | null;
  decisionTxHash: Hex | null;
  createdAt: string;
  updatedAt: string;
}

export interface EvaluationRecord {
  jobId: string;
  chainId: number;
  contractAddress: Hex;
  /** The delivery this verdict is about. A re-delivery invalidates the previous evaluation. */
  deliveryHash: Hex;
  verdict: Verdict;
  conformanceScore: number;
  safetyScore: number;
  reasons: string[];
  patternHits: string[];
  /** Canonical evidence object; its keccak256 is `evidenceHash`. */
  evidence: unknown;
  evidenceHash: Hex;
  verifierAddress: Hex;
  createdAt: string;
}

/** Composite identity of a job: one escrow deployment on one chain. */
export interface JobKey {
  chainId: number;
  contractAddress: Hex;
  jobId: string;
}

export interface Store {
  getJob(key: JobKey): Promise<JobRecord | null>;
  putJob(record: JobRecord): Promise<void>;
  updateJob(key: JobKey, patch: Partial<JobRecord>): Promise<JobRecord | null>;
  listJobs(limit?: number): Promise<JobRecord[]>;

  getEvaluation(key: JobKey): Promise<EvaluationRecord | null>;
  putEvaluation(record: EvaluationRecord): Promise<void>;

  /** Last block scanned by the delivery watcher, per chain + deployment. */
  getWatermark(chainId: number, contractAddress: Hex): Promise<bigint | null>;
  setWatermark(chainId: number, contractAddress: Hex, block: bigint): Promise<void>;
}

export function jobKeyString(key: JobKey): string {
  return `${key.chainId}:${key.contractAddress.toLowerCase()}:${key.jobId}`;
}

export function sameKey(a: JobKey, b: JobKey): boolean {
  return jobKeyString(a) === jobKeyString(b);
}
