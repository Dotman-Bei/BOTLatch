/**
 * Evidence canonicalisation and EIP-712 decision signing.
 *
 * The evidence object is the auditable record of *why* a verdict was reached. Only its keccak256
 * goes on-chain, so canonicalisation must be deterministic: the same evaluation must always
 * produce the same hash, on any machine, in any key order.
 */

import { keccak256, toHex, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { POLICY_VERSION } from "./policy.js";
import type {
  DecisionPayload,
  DeterministicReport,
  Evaluation,
  Evidence,
  LlmAssessment,
  SignedDecision,
} from "./types.js";
import { VERDICT_ENUM } from "./types.js";

/** EIP-712 domain. Must match `EIP712("BOTLatch", "1")` in AgentWorkEscrow. */
export const EIP712_DOMAIN_NAME = "BOTLatch";
export const EIP712_DOMAIN_VERSION = "1";

/** Type definition mirroring the on-chain DECISION_TYPEHASH exactly. */
export const DECISION_TYPES = {
  Decision: [
    { name: "jobId", type: "uint256" },
    { name: "briefHash", type: "bytes32" },
    { name: "deliveryHash", type: "bytes32" },
    { name: "evidenceHash", type: "bytes32" },
    { name: "verdict", type: "uint8" },
    { name: "validUntil", type: "uint64" },
  ],
} as const;

/** Decision lifetime. The contract independently rejects anything beyond one hour. */
export const DECISION_TTL_SECONDS = 12 * 60;

/**
 * Recursively sort object keys so `JSON.stringify` is stable.
 * Arrays keep their order — it is semantically meaningful for `reasons`.
 */
export function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return Object.fromEntries(entries.map(([k, v]) => [k, canonicalize(v)]));
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

/** keccak256 over the canonical JSON encoding of the evidence object. */
export function hashEvidence(evidence: Evidence): Hex {
  return keccak256(toHex(canonicalJson(evidence)));
}

export interface BuildEvidenceArgs {
  jobId: bigint | string;
  chainId: number;
  escrowAddress: Address;
  evaluation: Evaluation;
  deterministic: DeterministicReport;
  llm: LlmAssessment;
}

export function buildEvidence(args: BuildEvidenceArgs): Evidence {
  const { jobId, chainId, escrowAddress, evaluation, deterministic, llm } = args;

  const evidence: Evidence = {
    version: 1,
    jobId: jobId.toString(),
    chainId,
    escrowAddress,
    briefHash: evaluation.briefHash,
    deliveryHash: evaluation.deliveryHash,
    verdict: evaluation.verdict,
    conformance: llm.ok ? llm.conformance : "unavailable",
    safety: llm.ok ? llm.safety : "unavailable",
    conformanceScore: evaluation.conformanceScore,
    safetyScore: evaluation.safetyScore,
    reasons: evaluation.reasons,
    patternHits: evaluation.patternHits,
    deterministicPassed: deterministic.passed,
    llmOk: llm.ok,
    model: llm.model,
    modelOutputHash: llm.modelOutputHash,
    policyVersion: POLICY_VERSION,
    evaluatedAt: evaluation.evaluatedAt,
  };

  if (!llm.ok && llm.failureReason) evidence.llmFailureReason = llm.failureReason;

  return evidence;
}

export interface SignDecisionArgs {
  privateKey: Hex;
  chainId: number;
  escrowAddress: Address;
  jobId: bigint;
  briefHash: Hex;
  deliveryHash: Hex;
  evidenceHash: Hex;
  verdict: Evaluation["verdict"];
  /** Override for tests; defaults to now + DECISION_TTL_SECONDS. */
  validUntil?: bigint;
}

/**
 * Produce the EIP-712 signature the escrow will verify.
 *
 * The domain includes `chainId` and `verifyingContract`, so a signature is bound to one network
 * and one deployment. It cannot be replayed against a second chain or a redeployed escrow.
 */
export async function signDecision(args: SignDecisionArgs): Promise<SignedDecision> {
  const account = privateKeyToAccount(args.privateKey);

  const validUntil =
    args.validUntil ?? BigInt(Math.floor(Date.now() / 1000) + DECISION_TTL_SECONDS);

  const decision: DecisionPayload = {
    jobId: args.jobId,
    briefHash: args.briefHash,
    deliveryHash: args.deliveryHash,
    evidenceHash: args.evidenceHash,
    verdict: VERDICT_ENUM[args.verdict],
    validUntil,
  };

  const signature = await account.signTypedData({
    domain: {
      name: EIP712_DOMAIN_NAME,
      version: EIP712_DOMAIN_VERSION,
      chainId: args.chainId,
      verifyingContract: args.escrowAddress,
    },
    types: DECISION_TYPES,
    primaryType: "Decision",
    message: decision,
  });

  return {
    decision,
    signature,
    verifierAddress: account.address,
    decisionJson: {
      jobId: decision.jobId.toString(),
      briefHash: decision.briefHash,
      deliveryHash: decision.deliveryHash,
      evidenceHash: decision.evidenceHash,
      verdict: decision.verdict,
      validUntil: decision.validUntil.toString(),
    },
  };
}

/** Public address of the configured verifier key, for display and README verification. */
export function verifierAddressFromKey(privateKey: Hex): Address {
  return privateKeyToAccount(privateKey).address;
}

/** keccak256 of UTF-8 content, matching the browser-side hash used for briefs and deliveries. */
export function hashContent(content: string): Hex {
  return keccak256(toHex(content));
}
