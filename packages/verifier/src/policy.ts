/**
 * Fail-safe decision policy.
 *
 * This is the rule table from the build guide, expressed as code so it can be tested directly.
 * The invariant that matters more than any other:
 *
 *   **A model or API failure must never produce GO.**
 *
 * Every path that lacks positive evidence of safety resolves to CAUTION (funds held for the
 * buyer) or NO_GO (funds refunded). GO requires the deterministic layer to pass *and* the LLM
 * layer to have succeeded *and* said both safe and on-spec.
 */

import type {
  DeterministicReport,
  Evaluation,
  LlmAssessment,
  PatternHit,
  Verdict,
} from "./types.js";

export const POLICY_VERSION = "botlatch-policy-1";

export interface PolicyInput {
  deterministic: DeterministicReport;
  llm: LlmAssessment;
  /** Length of the raw delivery, used for the emptiness guard. */
  deliveryLength: number;
}

export interface PolicyOutput {
  verdict: Verdict;
  reasons: string[];
  conformanceScore: number;
  safetyScore: number;
}

/** Minimum characters before a delivery is treated as substantive at all. */
export const MIN_DELIVERY_CHARS = 40;

const CONFORMANCE_SCORE: Record<LlmAssessment["conformance"], number> = {
  pass: 92,
  partial: 55,
  fail: 12,
};

const SAFETY_BASE: Record<LlmAssessment["safety"], number> = {
  safe: 95,
  suspicious: 45,
  hostile: 5,
};

const SEVERITY_PENALTY: Record<PatternHit["severity"], number> = {
  critical: 95,
  high: 60,
  medium: 20,
};

function severityRank(hits: PatternHit[]): PatternHit["severity"] | null {
  if (hits.some((h) => h.severity === "critical")) return "critical";
  if (hits.some((h) => h.severity === "high")) return "high";
  if (hits.some((h) => h.severity === "medium")) return "medium";
  return null;
}

function clampScore(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

/** Deduplicate while preserving order, and cap the list the UI has to render. */
function tidyReasons(reasons: string[], limit = 4): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const reason of reasons) {
    const trimmed = reason.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
    if (out.length >= limit) break;
  }
  return out.length > 0 ? out : ["No specific findings were recorded."];
}

/**
 * Apply the decision table.
 *
 * Order matters: the blocking checks run first so that a hostile delivery cannot be rescued by
 * a model that judged it benign.
 */
export function decide(input: PolicyInput): PolicyOutput {
  const { deterministic, llm, deliveryLength } = input;
  const reasons: string[] = [];

  const worst = severityRank(deterministic.hits);
  const criticalOrHigh = deterministic.hits.filter(
    (h) => h.severity === "critical" || h.severity === "high",
  );

  // Scores are advisory context for the UI; the verdict below is decided categorically.
  const safetyScore = clampScore(
    (llm.ok ? SAFETY_BASE[llm.safety] : 40) - (worst ? SEVERITY_PENALTY[worst] : 0),
  );
  const conformanceScore = clampScore(llm.ok ? CONFORMANCE_SCORE[llm.conformance] : 50);

  // --- 1. Deterministic blocking layer: hostile content forces NO_GO ------------------
  if (criticalOrHigh.length > 0) {
    for (const hit of criticalOrHigh.slice(0, 3)) reasons.push(hit.label + ".");
    reasons.push(
      "BOTLatch treats a delivery that issues instructions to the reader as unsafe to consume, so the payment was refunded.",
    );
    return {
      verdict: "NO_GO",
      reasons: tidyReasons(reasons),
      conformanceScore,
      safetyScore: Math.min(safetyScore, 10),
    };
  }

  // --- 2. Structural guards ------------------------------------------------------------
  if (deliveryLength < MIN_DELIVERY_CHARS) {
    reasons.push("The delivery is too short to constitute a usable response to the brief.");
    return { verdict: "NO_GO", reasons: tidyReasons(reasons), conformanceScore: 5, safetyScore };
  }

  // --- 3. LLM layer unavailable: hold, never release -----------------------------------
  if (!llm.ok) {
    reasons.push(
      "The AI conformance review could not be completed, so BOTLatch held the funds instead of releasing them.",
    );
    if (llm.failureReason) reasons.push(`Reviewer status: ${llm.failureReason}.`);
    reasons.push("The buyer can release or refund this job manually.");
    return {
      verdict: "CAUTION",
      reasons: tidyReasons(reasons),
      conformanceScore,
      safetyScore,
    };
  }

  // --- 4. Semantic hostility -----------------------------------------------------------
  if (llm.safety === "hostile") {
    reasons.push(...llm.reasons);
    reasons.push("The reviewer judged the delivery hostile to the agent that would consume it.");
    return { verdict: "NO_GO", reasons: tidyReasons(reasons), conformanceScore, safetyScore };
  }

  // --- 5. Clearly off-spec --------------------------------------------------------------
  if (llm.conformance === "fail") {
    reasons.push(...llm.reasons);
    reasons.push("The delivery does not answer the brief, so the buyer was refunded.");
    return { verdict: "NO_GO", reasons: tidyReasons(reasons), conformanceScore, safetyScore };
  }

  // --- 6. Uncertainty: hold for the buyer ------------------------------------------------
  if (llm.safety === "suspicious" || llm.conformance === "partial" || worst === "medium") {
    reasons.push(...llm.reasons);
    if (worst === "medium") {
      const medium = deterministic.hits.find((h) => h.severity === "medium");
      if (medium) reasons.push(`${medium.label}.`);
    }
    reasons.push("BOTLatch held the funds so the buyer can decide.");
    return { verdict: "CAUTION", reasons: tidyReasons(reasons), conformanceScore, safetyScore };
  }

  // --- 7. Positive evidence on both layers ------------------------------------------------
  reasons.push(...llm.reasons);
  reasons.push("Safety screening found no instructions aimed at the reader.");
  return { verdict: "GO", reasons: tidyReasons(reasons), conformanceScore, safetyScore };
}

/** Assemble the stable `Evaluation` shape consumed by the API and UI. */
export function toEvaluation(
  policy: PolicyOutput,
  deterministic: DeterministicReport,
  llm: LlmAssessment,
  hashes: { briefHash: `0x${string}`; deliveryHash: `0x${string}` },
  evaluatedAt = new Date().toISOString(),
): Evaluation {
  return {
    verdict: policy.verdict,
    conformanceScore: policy.conformanceScore,
    safetyScore: policy.safetyScore,
    reasons: policy.reasons,
    patternHits: deterministic.hits.map((h) => h.id),
    model: llm.model,
    modelOutputHash: llm.modelOutputHash,
    briefHash: hashes.briefHash,
    deliveryHash: hashes.deliveryHash,
    evaluatedAt,
  };
}
