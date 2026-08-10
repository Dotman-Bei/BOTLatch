/**
 * The public shape of a job.
 *
 * Two content rules, applied here so every route inherits them:
 *
 *   - The **brief** is returned. The provider needs it to do the work, and the buyer hands out the
 *     delivery link precisely so it can be read.
 *   - The **delivery** is never returned, only its hash. It is the provider's work product and the
 *     buyer paid for it; the app has no login, so anyone with a job id would otherwise be able to
 *     read unreleased work. Verification happens server-side, where the text never leaves the box.
 *
 * Evidence is emitted as-is because the verifier already built it to be publishable: it carries
 * hashes, scores, bounded reasons and redacted excerpts — never brief or delivery content.
 */

import type { Hex } from "viem";
import { statusName, verdictName } from "./abi";
import type { OnChainJob } from "./chain-server";
import type { EvaluationRecord, JobRecord } from "./store";

export interface PublicJob {
  jobId: string;
  chainId: number;
  contractAddress: Hex;
  buyer: Hex;
  provider: Hex;
  amountWei: string;
  status: string;
  statusCode: number;
  verdict: string;
  verdictCode: number;
  briefHash: Hex;
  deliveryHash: Hex | null;
  deliverBy: number;
  createdAt: number;
  title: string;
  brief: string | null;
  hasDeliveryText: boolean;
  createdTxHash: Hex | null;
  deliveryTxHash: Hex | null;
  decisionTxHash: Hex | null;
}

export interface PublicEvaluation {
  verdict: string;
  conformanceScore: number;
  safetyScore: number;
  reasons: string[];
  patternHits: string[];
  evidenceHash: Hex;
  evidence: unknown;
  verifierAddress: Hex;
  deliveryHash: Hex;
  createdAt: string;
  /** False when the provider re-delivered after this verdict was produced. */
  current: boolean;
}

const ZERO_HASH = `0x${"0".repeat(64)}` as Hex;

export function toPublicJob(
  jobId: string,
  chainId: number,
  contractAddress: Hex,
  onChain: OnChainJob,
  record: JobRecord | null,
): PublicJob {
  const deliveryHash = onChain.deliveryHash === ZERO_HASH ? null : onChain.deliveryHash;
  return {
    jobId,
    chainId,
    contractAddress,
    buyer: onChain.buyer,
    provider: onChain.provider,
    amountWei: onChain.amount.toString(),
    status: statusName(onChain.status),
    statusCode: onChain.status,
    verdict: verdictName(onChain.verdict),
    verdictCode: onChain.verdict,
    briefHash: onChain.briefHash,
    deliveryHash,
    deliverBy: Number(onChain.deliverBy),
    createdAt: Number(onChain.createdAt),
    title: record?.title ?? "",
    brief: record?.brief ?? null,
    hasDeliveryText: Boolean(record?.delivery),
    createdTxHash: record?.createdTxHash ?? null,
    deliveryTxHash: record?.deliveryTxHash ?? null,
    decisionTxHash: record?.decisionTxHash ?? null,
  };
}

export function toPublicEvaluation(
  record: EvaluationRecord,
  onChainDeliveryHash: Hex | null,
): PublicEvaluation {
  return {
    verdict: record.verdict,
    conformanceScore: record.conformanceScore,
    safetyScore: record.safetyScore,
    reasons: record.reasons,
    patternHits: record.patternHits,
    evidenceHash: record.evidenceHash,
    evidence: record.evidence,
    verifierAddress: record.verifierAddress,
    deliveryHash: record.deliveryHash,
    createdAt: record.createdAt,
    current:
      onChainDeliveryHash !== null &&
      onChainDeliveryHash.toLowerCase() === record.deliveryHash.toLowerCase(),
  };
}
