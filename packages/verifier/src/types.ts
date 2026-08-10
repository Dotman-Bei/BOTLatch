import type { Hex } from "viem";

/** Final settlement-controlling verdict. */
export type Verdict = "GO" | "CAUTION" | "NO_GO";

/** On-chain enum ordering in AgentWorkEscrow.Verdict. */
export const VERDICT_ENUM: Record<Verdict, 0 | 1 | 2 | 3> = {
  GO: 1,
  CAUTION: 2,
  NO_GO: 3,
};

export const VERDICT_FROM_ENUM: Record<number, Verdict | "NONE"> = {
  0: "NONE",
  1: "GO",
  2: "CAUTION",
  3: "NO_GO",
};

/** What the LLM layer is allowed to say. Kept coarse on purpose — it is a judgement, not a score. */
export type Conformance = "pass" | "partial" | "fail";
export type Safety = "safe" | "suspicious" | "hostile";

/** A deterministic pattern match against the normalized delivery text. */
export interface PatternHit {
  /** Stable identifier, e.g. `injection.override_instructions`. */
  id: string;
  /** How the finding influences the verdict. */
  severity: "critical" | "high" | "medium";
  /** Which decoded layer the match was found in. */
  layer: "raw" | "normalized" | "base64" | "hex" | "unicode-escape" | "despaced";
  /** Short, user-facing description. Never echoes attacker-controlled text verbatim. */
  label: string;
  /** Redacted excerpt (bounded length, control characters stripped). */
  excerpt: string;
}

export interface DeterministicReport {
  /** True when nothing critical/high was found. */
  passed: boolean;
  hits: PatternHit[];
  /** Layers that were successfully decoded and scanned. */
  layersScanned: string[];
  /** Characters removed during normalization (zero-width, bidi controls). */
  suspiciousCharacterCount: number;
  normalizedLength: number;
}

export interface LlmAssessment {
  conformance: Conformance;
  safety: Safety;
  reasons: string[];
  /** Present only when the model call succeeded and returned schema-valid JSON. */
  ok: boolean;
  /** Populated when `ok` is false — timeout, bad JSON, HTTP error, missing key. */
  failureReason?: string;
  model: string;
  requestId?: string;
  /** keccak256 of the raw model output, so a decision can be audited without storing content. */
  modelOutputHash: Hex;
}

/** The stable evaluator contract consumed by the app and the API. */
export interface Evaluation {
  verdict: Verdict;
  conformanceScore: number; // 0–100
  safetyScore: number; // 0–100
  reasons: string[];
  patternHits: string[];
  model: string;
  modelOutputHash: Hex;
  briefHash: Hex;
  deliveryHash: Hex;
  evaluatedAt: string;
}

/** Canonical evidence object. Its keccak256 is what gets signed and put on-chain. */
export interface Evidence {
  version: 1;
  jobId: string;
  chainId: number;
  escrowAddress: Hex;
  briefHash: Hex;
  deliveryHash: Hex;
  verdict: Verdict;
  conformance: Conformance | "unavailable";
  safety: Safety | "unavailable";
  conformanceScore: number;
  safetyScore: number;
  reasons: string[];
  patternHits: string[];
  deterministicPassed: boolean;
  llmOk: boolean;
  llmFailureReason?: string;
  model: string;
  modelOutputHash: Hex;
  policyVersion: string;
  evaluatedAt: string;
}

/** EIP-712 `Decision` payload, matching the struct in AgentWorkEscrow. */
export interface DecisionPayload {
  jobId: bigint;
  briefHash: Hex;
  deliveryHash: Hex;
  evidenceHash: Hex;
  verdict: number;
  validUntil: bigint;
}

export interface SignedDecision {
  decision: DecisionPayload;
  signature: Hex;
  verifierAddress: Hex;
  /** Convenience mirror for JSON transport, since bigint is not JSON-serialisable. */
  decisionJson: {
    jobId: string;
    briefHash: Hex;
    deliveryHash: Hex;
    evidenceHash: Hex;
    verdict: number;
    validUntil: string;
  };
}

export interface VerificationResult {
  evaluation: Evaluation;
  evidence: Evidence;
  evidenceHash: Hex;
  deterministic: DeterministicReport;
  llm: LlmAssessment;
  signed: SignedDecision;
}
