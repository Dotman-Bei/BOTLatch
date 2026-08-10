/**
 * End-to-end pipeline tests.
 *
 * These carry the headline claim from the build guide:
 *
 *   *No malicious payload in the corpus can produce a signed GO, and a clean payload produces a
 *   signed GO the contract will accept.*
 *
 * The model is stubbed, not mocked away: the stub plays a *cooperative, correct* reviewer, which
 * is the most permissive assumption available. If a hostile fixture still cannot reach GO with a
 * maximally agreeable model behind it, it cannot reach GO in production either. A second suite
 * then replaces the stub with a *compromised* model that always says "safe, pass" — the case
 * where the semantic layer has been fully subverted.
 */

import { describe, expect, it } from "vitest";
import { recoverTypedDataAddress, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { DECISION_TYPES, EIP712_DOMAIN_NAME, EIP712_DOMAIN_VERSION, hashContent } from "../src/sign.js";
import { DeliveryTooLargeError, HashMismatchError, assertHashesMatch, verifyDelivery } from "../src/evaluate.js";
import { MAX_DELIVERY_CHARS } from "../src/patterns.js";
import { POLICY_VERSION } from "../src/policy.js";
import type { LlmConfig } from "../src/llm.js";
import type { SignedDecision } from "../src/types.js";
import { VERDICT_ENUM } from "../src/types.js";
import { BRIEF, FIXTURES, HOSTILE_FIXTURES } from "./fixtures.js";

const VERIFIER_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as Hex;
const VERIFIER_ADDRESS = privateKeyToAccount(VERIFIER_KEY).address;
const ESCROW = "0x5FbDB2315678afecb367f032d93F642f64180aa3" as Address;
const CHAIN_ID = 677;

/** Build an LlmConfig whose fetch returns a fixed assessment. */
function stubModel(assessment: {
  conformance: "pass" | "partial" | "fail";
  safety: "safe" | "suspicious" | "hostile";
  reasons: string[];
}): LlmConfig {
  return {
    apiKey: "test-key",
    model: "stub-model",
    baseUrl: "https://llm.test",
    timeoutMs: 5_000,
    fetchImpl: (async () =>
      new Response(
        JSON.stringify({ content: [{ type: "text", text: JSON.stringify(assessment) }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      )) as unknown as typeof fetch,
  };
}

/** A model that is down. Every call throws. */
const BROKEN_MODEL: LlmConfig = {
  apiKey: "test-key",
  model: "stub-model",
  baseUrl: "https://llm.test",
  timeoutMs: 5_000,
  fetchImpl: (async () => {
    throw new Error("ECONNREFUSED");
  }) as unknown as typeof fetch,
};

/** A model that has been fully subverted and rubber-stamps everything. */
const COMPROMISED_MODEL = stubModel({
  conformance: "pass",
  safety: "safe",
  reasons: ["Everything looks perfect to me."],
});

/**
 * A cooperative reviewer. Since the stub cannot actually read, it is driven by each fixture's
 * declared `expected` verdict — this models the best case for the semantic layer, so any hostile
 * fixture that still fails to reach GO fails for structural reasons, not model behaviour.
 */
function cooperativeModelFor(expected: "GO" | "CAUTION" | "NO_GO"): LlmConfig {
  if (expected === "GO") {
    return stubModel({
      conformance: "pass",
      safety: "safe",
      reasons: ["The delivery satisfies every requirement in the brief."],
    });
  }
  if (expected === "CAUTION") {
    return stubModel({
      conformance: "partial",
      safety: "safe",
      reasons: ["The delivery is on topic but does not cover every stated requirement."],
    });
  }
  // Off-spec but safe: conformance, not hostility, is what refunds the buyer here.
  return stubModel({
    conformance: "fail",
    safety: "safe",
    reasons: ["The delivery does not address the brief."],
  });
}

const BASE_ARGS = {
  jobId: 1n,
  chainId: CHAIN_ID,
  escrowAddress: ESCROW,
  brief: BRIEF,
  verifierPrivateKey: VERIFIER_KEY,
  now: new Date("2026-08-10T12:00:00.000Z"),
};

async function recoverSigner(signed: SignedDecision): Promise<Address> {
  return recoverTypedDataAddress({
    domain: {
      name: EIP712_DOMAIN_NAME,
      version: EIP712_DOMAIN_VERSION,
      chainId: CHAIN_ID,
      verifyingContract: ESCROW,
    },
    types: DECISION_TYPES,
    primaryType: "Decision",
    message: signed.decision,
    signature: signed.signature,
  });
}

describe("pipeline: the fixture corpus", () => {
  it.each(FIXTURES.map((f) => [f.name, f] as const))(
    "reaches the expected verdict for %s",
    async (_name, fixture) => {
      const result = await verifyDelivery({
        ...BASE_ARGS,
        delivery: fixture.delivery,
        llmConfig: cooperativeModelFor(fixture.expected),
      });
      expect(result.evaluation.verdict).toBe(fixture.expected);
    },
  );

  it.each(HOSTILE_FIXTURES.map((f) => [f.name, f] as const))(
    "refuses %s even when the model has been compromised",
    async (_name, fixture) => {
      const result = await verifyDelivery({
        ...BASE_ARGS,
        delivery: fixture.delivery,
        llmConfig: COMPROMISED_MODEL,
      });
      expect(result.evaluation.verdict).toBe("NO_GO");
    },
  );

  it.each(HOSTILE_FIXTURES.map((f) => [f.name, f] as const))(
    "refuses %s even when the model is unreachable",
    async (_name, fixture) => {
      const result = await verifyDelivery({
        ...BASE_ARGS,
        delivery: fixture.delivery,
        llmConfig: BROKEN_MODEL,
      });
      expect(result.evaluation.verdict).toBe("NO_GO");
    },
  );

  it("never signs a GO for any hostile fixture under any model behaviour", async () => {
    const models = [COMPROMISED_MODEL, BROKEN_MODEL, cooperativeModelFor("GO")];

    for (const fixture of HOSTILE_FIXTURES) {
      for (const llmConfig of models) {
        const result = await verifyDelivery({ ...BASE_ARGS, delivery: fixture.delivery, llmConfig });
        expect(result.evaluation.verdict).toBe("NO_GO");
        expect(result.signed.decision.verdict).toBe(VERDICT_ENUM.NO_GO);
      }
    }
  });

  it("does not send hostile content to the model at all", async () => {
    let called = 0;
    const countingModel: LlmConfig = {
      ...COMPROMISED_MODEL,
      fetchImpl: (async () => {
        called += 1;
        return new Response(
          JSON.stringify({
            content: [
              {
                type: "text",
                text: JSON.stringify({ conformance: "pass", safety: "safe", reasons: ["ok"] }),
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }) as unknown as typeof fetch,
    };

    const hostile = HOSTILE_FIXTURES[0]!;
    await verifyDelivery({ ...BASE_ARGS, delivery: hostile.delivery, llmConfig: countingModel });
    expect(called).toBe(0);

    const clean = FIXTURES.find((f) => f.expected === "GO")!;
    await verifyDelivery({ ...BASE_ARGS, delivery: clean.delivery, llmConfig: countingModel });
    expect(called).toBe(1);
  });
});

describe("pipeline: the signed decision", () => {
  const cleanFixture = FIXTURES.find((f) => f.expected === "GO")!;

  it("produces a GO signature that recovers to the verifier", async () => {
    const result = await verifyDelivery({
      ...BASE_ARGS,
      delivery: cleanFixture.delivery,
      llmConfig: cooperativeModelFor("GO"),
    });

    expect(result.evaluation.verdict).toBe("GO");
    expect(result.signed.decision.verdict).toBe(VERDICT_ENUM.GO);
    expect(result.signed.verifierAddress).toBe(VERIFIER_ADDRESS);
    expect(await recoverSigner(result.signed)).toBe(VERIFIER_ADDRESS);
  });

  it("binds the signature to the exact brief and delivery evaluated", async () => {
    const result = await verifyDelivery({
      ...BASE_ARGS,
      delivery: cleanFixture.delivery,
      llmConfig: cooperativeModelFor("GO"),
    });

    expect(result.signed.decision.briefHash).toBe(hashContent(BRIEF));
    expect(result.signed.decision.deliveryHash).toBe(hashContent(cleanFixture.delivery));
    expect(result.evaluation.briefHash).toBe(result.signed.decision.briefHash);
  });

  it("commits to the evidence that justified the verdict", async () => {
    const result = await verifyDelivery({
      ...BASE_ARGS,
      delivery: cleanFixture.delivery,
      llmConfig: cooperativeModelFor("GO"),
    });

    expect(result.signed.decision.evidenceHash).toBe(result.evidenceHash);
    expect(result.evidence.verdict).toBe("GO");
    expect(result.evidence.policyVersion).toBe(POLICY_VERSION);
    expect(result.evidence.jobId).toBe("1");
    expect(result.evidence.chainId).toBe(CHAIN_ID);
  });

  it("signs a CAUTION when the model layer is unavailable on clean content", async () => {
    const result = await verifyDelivery({
      ...BASE_ARGS,
      delivery: cleanFixture.delivery,
      llmConfig: BROKEN_MODEL,
    });

    expect(result.evaluation.verdict).toBe("CAUTION");
    expect(result.signed.decision.verdict).toBe(VERDICT_ENUM.CAUTION);
    expect(result.evidence.llmOk).toBe(false);
    expect(result.evidence.llmFailureReason).toMatch(/ECONNREFUSED/);
    expect(await recoverSigner(result.signed)).toBe(VERIFIER_ADDRESS);
  });

  it("emits a decision inside the contract's TTL ceiling", async () => {
    const result = await verifyDelivery({
      ...BASE_ARGS,
      delivery: cleanFixture.delivery,
      llmConfig: cooperativeModelFor("GO"),
    });

    const ttl = result.signed.decision.validUntil - BigInt(Math.floor(Date.now() / 1000));
    expect(ttl).toBeGreaterThan(0n);
    expect(ttl).toBeLessThanOrEqual(3600n);
  });

  it("never signs verdict 0, which the contract rejects as None", async () => {
    for (const fixture of FIXTURES) {
      const result = await verifyDelivery({
        ...BASE_ARGS,
        delivery: fixture.delivery,
        llmConfig: cooperativeModelFor(fixture.expected),
      });
      expect(result.signed.decision.verdict).toBeGreaterThan(0);
      expect(result.signed.decision.verdict).toBeLessThanOrEqual(3);
    }
  });

  it("keeps the buyer's and provider's content out of the evidence", async () => {
    const result = await verifyDelivery({
      ...BASE_ARGS,
      delivery: cleanFixture.delivery,
      llmConfig: cooperativeModelFor("GO"),
    });

    const serialized = JSON.stringify(result.evidence);
    expect(serialized).not.toContain(cleanFixture.delivery.slice(0, 80));
    expect(serialized).not.toContain(BRIEF.slice(0, 60));
  });

  it("is reproducible: the same inputs yield the same evidence hash", async () => {
    const args = {
      ...BASE_ARGS,
      delivery: cleanFixture.delivery,
      llmConfig: cooperativeModelFor("GO"),
      validUntil: 1893456000n,
    };
    const a = await verifyDelivery(args);
    const b = await verifyDelivery(args);

    expect(b.evidenceHash).toBe(a.evidenceHash);
    expect(b.signed.signature).toBe(a.signed.signature);
  });
});

describe("pipeline: operator guards", () => {
  it("refuses an oversized delivery instead of truncating it silently", async () => {
    await expect(
      verifyDelivery({
        ...BASE_ARGS,
        delivery: "x".repeat(MAX_DELIVERY_CHARS + 1),
        llmConfig: cooperativeModelFor("GO"),
      }),
    ).rejects.toBeInstanceOf(DeliveryTooLargeError);
  });

  it("accepts a delivery exactly at the size limit", async () => {
    const filler = "The domain separator binds a signature to a chain. ".repeat(1300);
    const result = await verifyDelivery({
      ...BASE_ARGS,
      delivery: filler.slice(0, MAX_DELIVERY_CHARS),
      llmConfig: cooperativeModelFor("GO"),
    });
    expect(result.evaluation.verdict).toBe("GO");
  });

  it("accepts content whose hashes match the on-chain commitments", () => {
    expect(() =>
      assertHashesMatch(BRIEF, "the delivery", {
        briefHash: hashContent(BRIEF),
        deliveryHash: hashContent("the delivery"),
      }),
    ).not.toThrow();
  });

  it("rejects a swapped delivery before anything is signed", () => {
    expect(() =>
      assertHashesMatch(BRIEF, "a substituted delivery", {
        briefHash: hashContent(BRIEF),
        deliveryHash: hashContent("the delivery the provider committed to"),
      }),
    ).toThrow(HashMismatchError);
  });

  it("rejects a swapped brief before anything is signed", () => {
    expect(() =>
      assertHashesMatch("a different brief", "the delivery", {
        briefHash: hashContent(BRIEF),
        deliveryHash: hashContent("the delivery"),
      }),
    ).toThrow(HashMismatchError);
  });

  it("compares hashes case-insensitively, since casing is not semantic", () => {
    const briefHash = hashContent(BRIEF);
    expect(() =>
      assertHashesMatch(BRIEF, "d", {
        briefHash: briefHash.toUpperCase().replace("0X", "0x") as Hex,
        deliveryHash: hashContent("d"),
      }),
    ).not.toThrow();
  });
});
