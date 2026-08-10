import { describe, expect, it } from "vitest";
import { MIN_DELIVERY_CHARS, POLICY_VERSION, decide } from "../src/policy.js";
import type {
  Conformance,
  DeterministicReport,
  LlmAssessment,
  PatternHit,
  Safety,
} from "../src/types.js";

const ZERO_HASH = `0x${"0".repeat(64)}` as const;

function report(overrides: Partial<DeterministicReport> = {}): DeterministicReport {
  return {
    passed: true,
    hits: [],
    layersScanned: ["raw", "normalized"],
    suspiciousCharacterCount: 0,
    normalizedLength: 500,
    ...overrides,
  };
}

function hit(severity: PatternHit["severity"], id = "injection.test"): PatternHit {
  return { id, severity, layer: "normalized", label: "A test signature fired", excerpt: "..." };
}

function llm(overrides: Partial<LlmAssessment> = {}): LlmAssessment {
  return {
    conformance: "pass",
    safety: "safe",
    reasons: ["The delivery answers every requirement in the brief."],
    ok: true,
    model: "test-model",
    modelOutputHash: ZERO_HASH,
    ...overrides,
  };
}

const LONG_ENOUGH = MIN_DELIVERY_CHARS + 500;

const CONFORMANCES: Conformance[] = ["pass", "partial", "fail"];
const SAFETIES: Safety[] = ["safe", "suspicious", "hostile"];
const SEVERITIES: Array<PatternHit["severity"] | null> = ["critical", "high", "medium", null];

describe("policy: the fail-safe invariant", () => {
  it("never returns GO when the model layer failed", () => {
    for (const worst of SEVERITIES) {
      const result = decide({
        deterministic: report({ hits: worst ? [hit(worst)] : [], passed: worst === null }),
        llm: llm({ ok: false, failureReason: "LLM timeout after 20000ms" }),
        deliveryLength: LONG_ENOUGH,
      });
      expect(result.verdict).not.toBe("GO");
    }
  });

  it("holds funds rather than refunding them when the model is merely unavailable", () => {
    const result = decide({
      deterministic: report(),
      llm: llm({ ok: false, failureReason: "LLM HTTP 503" }),
      deliveryLength: LONG_ENOUGH,
    });

    expect(result.verdict).toBe("CAUTION");
    expect(result.reasons.join(" ")).toMatch(/could not be completed/i);
    expect(result.reasons.join(" ")).toContain("LLM HTTP 503");
  });

  it("never returns GO when a critical or high signature fired, whatever the model said", () => {
    for (const severity of ["critical", "high"] as const) {
      for (const conformance of CONFORMANCES) {
        for (const safety of SAFETIES) {
          const result = decide({
            deterministic: report({ passed: false, hits: [hit(severity)] }),
            llm: llm({ conformance, safety }),
            deliveryLength: LONG_ENOUGH,
          });
          expect(result.verdict).toBe("NO_GO");
        }
      }
    }
  });

  it("returns GO only for the single fully-positive combination", () => {
    for (const conformance of CONFORMANCES) {
      for (const safety of SAFETIES) {
        for (const worst of SEVERITIES) {
          for (const ok of [true, false]) {
            const verdict = decide({
              deterministic: report({
                passed: worst === null || worst === "medium",
                hits: worst ? [hit(worst)] : [],
              }),
              llm: llm({ conformance, safety, ok }),
              deliveryLength: LONG_ENOUGH,
            }).verdict;

            const shouldBeGo =
              ok && conformance === "pass" && safety === "safe" && worst === null;

            expect(verdict === "GO").toBe(shouldBeGo);
          }
        }
      }
    }
  });
});

describe("policy: blocking rules", () => {
  it("refuses a delivery that is too short to be substantive", () => {
    const result = decide({
      deterministic: report(),
      llm: llm(),
      deliveryLength: MIN_DELIVERY_CHARS - 1,
    });
    expect(result.verdict).toBe("NO_GO");
    expect(result.conformanceScore).toBe(5);
  });

  it("accepts a delivery exactly at the length floor", () => {
    const result = decide({
      deterministic: report(),
      llm: llm(),
      deliveryLength: MIN_DELIVERY_CHARS,
    });
    expect(result.verdict).toBe("GO");
  });

  it("refunds on semantic hostility even with a clean deterministic pass", () => {
    const result = decide({
      deterministic: report(),
      llm: llm({ safety: "hostile", reasons: ["The delivery instructs the reader to pay out."] }),
      deliveryLength: LONG_ENOUGH,
    });
    expect(result.verdict).toBe("NO_GO");
  });

  it("refunds work that does not answer the brief", () => {
    const result = decide({
      deterministic: report(),
      llm: llm({ conformance: "fail", reasons: ["The delivery is about an unrelated topic."] }),
      deliveryLength: LONG_ENOUGH,
    });
    expect(result.verdict).toBe("NO_GO");
  });
});

describe("policy: holding rules", () => {
  it("holds on partial conformance", () => {
    expect(
      decide({
        deterministic: report(),
        llm: llm({ conformance: "partial" }),
        deliveryLength: LONG_ENOUGH,
      }).verdict,
    ).toBe("CAUTION");
  });

  it("holds on suspicious safety", () => {
    expect(
      decide({
        deterministic: report(),
        llm: llm({ safety: "suspicious" }),
        deliveryLength: LONG_ENOUGH,
      }).verdict,
    ).toBe("CAUTION");
  });

  it("holds on a medium signature alone, and surfaces it", () => {
    const result = decide({
      deterministic: report({ hits: [hit("medium", "suspicious.encoded_payload")] }),
      llm: llm(),
      deliveryLength: LONG_ENOUGH,
    });
    expect(result.verdict).toBe("CAUTION");
    expect(result.reasons.join(" ")).toContain("A test signature fired");
  });
});

describe("policy: reported detail", () => {
  it("keeps scores inside 0-100", () => {
    for (const conformance of CONFORMANCES) {
      for (const safety of SAFETIES) {
        for (const worst of SEVERITIES) {
          const result = decide({
            deterministic: report({ hits: worst ? [hit(worst)] : [] }),
            llm: llm({ conformance, safety }),
            deliveryLength: LONG_ENOUGH,
          });
          for (const score of [result.conformanceScore, result.safetyScore]) {
            expect(score).toBeGreaterThanOrEqual(0);
            expect(score).toBeLessThanOrEqual(100);
            expect(Number.isInteger(score)).toBe(true);
          }
        }
      }
    }
  });

  it("always produces at least one reason and at most four", () => {
    const result = decide({
      deterministic: report(),
      llm: llm({ reasons: ["a", "b", "c", "d", "e", "f"] }),
      deliveryLength: LONG_ENOUGH,
    });
    expect(result.reasons.length).toBeGreaterThanOrEqual(1);
    expect(result.reasons.length).toBeLessThanOrEqual(4);
  });

  it("deduplicates repeated reasons case-insensitively", () => {
    const result = decide({
      deterministic: report(),
      llm: llm({ reasons: ["Same reason.", "same reason.", "SAME REASON."] }),
      deliveryLength: LONG_ENOUGH,
    });
    expect(result.reasons.filter((r) => r.toLowerCase() === "same reason.")).toHaveLength(1);
  });

  it("falls back to a placeholder rather than an empty reason list", () => {
    const result = decide({
      deterministic: report(),
      llm: llm({ reasons: ["   "] }),
      deliveryLength: LONG_ENOUGH,
    });
    expect(result.reasons.length).toBeGreaterThan(0);
    expect(result.reasons.every((r) => r.trim().length > 0)).toBe(true);
  });

  it("pins the policy version so evidence stays interpretable", () => {
    expect(POLICY_VERSION).toBe("botlatch-policy-1");
  });
});
