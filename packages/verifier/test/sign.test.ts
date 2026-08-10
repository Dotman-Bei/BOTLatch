import { describe, expect, it } from "vitest";
import { keccak256, recoverTypedDataAddress, toHex, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  DECISION_TTL_SECONDS,
  DECISION_TYPES,
  EIP712_DOMAIN_NAME,
  EIP712_DOMAIN_VERSION,
  buildEvidence,
  canonicalJson,
  canonicalize,
  hashContent,
  hashEvidence,
  signDecision,
  verifierAddressFromKey,
} from "../src/sign.js";
import { POLICY_VERSION } from "../src/policy.js";
import type { DeterministicReport, Evaluation, Evidence, LlmAssessment } from "../src/types.js";
import { VERDICT_ENUM } from "../src/types.js";

const VERIFIER_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as Hex;
const ESCROW = "0x5FbDB2315678afecb367f032d93F642f64180aa3" as Address;
const CHAIN_ID = 677;

const ZERO_HASH = `0x${"0".repeat(64)}` as Hex;

const evaluation: Evaluation = {
  verdict: "GO",
  conformanceScore: 92,
  safetyScore: 95,
  reasons: ["The delivery answers every requirement.", "No instructions aimed at the reader."],
  patternHits: [],
  model: "test-model",
  modelOutputHash: ZERO_HASH,
  briefHash: hashContent("brief"),
  deliveryHash: hashContent("delivery"),
  evaluatedAt: "2026-08-10T12:00:00.000Z",
};

const deterministic: DeterministicReport = {
  passed: true,
  hits: [],
  layersScanned: ["raw", "normalized"],
  suspiciousCharacterCount: 0,
  normalizedLength: 1200,
};

const llm: LlmAssessment = {
  conformance: "pass",
  safety: "safe",
  reasons: ["On spec."],
  ok: true,
  model: "test-model",
  modelOutputHash: ZERO_HASH,
};

function evidenceFor(overrides: Partial<Evaluation> = {}): Evidence {
  return buildEvidence({
    jobId: 7n,
    chainId: CHAIN_ID,
    escrowAddress: ESCROW,
    evaluation: { ...evaluation, ...overrides },
    deterministic,
    llm,
  });
}

describe("canonicalisation", () => {
  it("produces identical JSON regardless of key insertion order", () => {
    const a = { z: 1, a: { d: 4, c: 3 }, m: [1, 2] };
    const b = { m: [1, 2], a: { c: 3, d: 4 }, z: 1 };
    expect(canonicalJson(a)).toBe(canonicalJson(b));
  });

  it("preserves array order, which carries meaning for reasons", () => {
    expect(canonicalJson({ r: ["second", "first"] })).toBe('{"r":["second","first"]}');
    expect(canonicalJson({ r: ["first", "second"] })).not.toBe(canonicalJson({ r: ["second", "first"] }));
  });

  it("drops undefined values instead of emitting null", () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}');
  });

  it("recurses through nested arrays of objects", () => {
    const value = canonicalize({ list: [{ b: 2, a: 1 }] });
    expect(JSON.stringify(value)).toBe('{"list":[{"a":1,"b":2}]}');
  });
});

describe("evidence", () => {
  it("hashes deterministically across repeated builds", () => {
    expect(hashEvidence(evidenceFor())).toBe(hashEvidence(evidenceFor()));
  });

  it("changes hash when any field changes", () => {
    const base = hashEvidence(evidenceFor());
    expect(hashEvidence(evidenceFor({ verdict: "CAUTION" }))).not.toBe(base);
    expect(hashEvidence(evidenceFor({ conformanceScore: 91 }))).not.toBe(base);
    expect(hashEvidence(evidenceFor({ reasons: ["Something else."] }))).not.toBe(base);
  });

  it("binds the evidence to one job, chain and deployment", () => {
    const evidence = evidenceFor();
    expect(evidence.jobId).toBe("7");
    expect(evidence.chainId).toBe(CHAIN_ID);
    expect(evidence.escrowAddress).toBe(ESCROW);
    expect(evidence.policyVersion).toBe(POLICY_VERSION);
  });

  it("records an unavailable model rather than pretending it answered", () => {
    const evidence = buildEvidence({
      jobId: 1n,
      chainId: CHAIN_ID,
      escrowAddress: ESCROW,
      evaluation: { ...evaluation, verdict: "CAUTION" },
      deterministic,
      llm: { ...llm, ok: false, failureReason: "LLM timeout after 20000ms" },
    });

    expect(evidence.conformance).toBe("unavailable");
    expect(evidence.safety).toBe("unavailable");
    expect(evidence.llmOk).toBe(false);
    expect(evidence.llmFailureReason).toBe("LLM timeout after 20000ms");
  });

  it("carries no brief or delivery content, only hashes", () => {
    const SECRET_BRIEF = "PROPRIETARY-BRIEF-TEXT-a1b2c3";
    const SECRET_DELIVERY = "CONFIDENTIAL-DELIVERY-TEXT-d4e5f6";

    const serialized = canonicalJson(
      buildEvidence({
        jobId: 7n,
        chainId: CHAIN_ID,
        escrowAddress: ESCROW,
        evaluation: {
          ...evaluation,
          briefHash: hashContent(SECRET_BRIEF),
          deliveryHash: hashContent(SECRET_DELIVERY),
        },
        deterministic,
        llm,
      }),
    );

    expect(serialized).not.toContain(SECRET_BRIEF);
    expect(serialized).not.toContain(SECRET_DELIVERY);
    expect(serialized).toContain(hashContent(SECRET_DELIVERY));
  });
});

describe("EIP-712 decision signing", () => {
  const domain = {
    name: EIP712_DOMAIN_NAME,
    version: EIP712_DOMAIN_VERSION,
    chainId: CHAIN_ID,
    verifyingContract: ESCROW,
  } as const;

  it("matches the Solidity DECISION_TYPEHASH", () => {
    // Must stay byte-identical to the constant in AgentWorkEscrow.sol.
    const typeString =
      "Decision(uint256 jobId,bytes32 briefHash,bytes32 deliveryHash,bytes32 evidenceHash,uint8 verdict,uint64 validUntil)";
    const encoded = `Decision(${DECISION_TYPES.Decision.map((f) => `${f.type} ${f.name}`).join(",")})`;
    expect(encoded).toBe(typeString);
    expect(keccak256(toHex(typeString))).toBe(keccak256(toHex(encoded)));
  });

  it("recovers to the configured verifier address", async () => {
    const signed = await signDecision({
      privateKey: VERIFIER_KEY,
      chainId: CHAIN_ID,
      escrowAddress: ESCROW,
      jobId: 7n,
      briefHash: evaluation.briefHash,
      deliveryHash: evaluation.deliveryHash,
      evidenceHash: hashEvidence(evidenceFor()),
      verdict: "GO",
    });

    expect(signed.verifierAddress).toBe(verifierAddressFromKey(VERIFIER_KEY));

    const recovered = await recoverTypedDataAddress({
      domain,
      types: DECISION_TYPES,
      primaryType: "Decision",
      message: signed.decision,
      signature: signed.signature,
    });
    expect(recovered).toBe(privateKeyToAccount(VERIFIER_KEY).address);
  });

  it("encodes the verdict using the on-chain enum ordering", async () => {
    for (const verdict of ["GO", "CAUTION", "NO_GO"] as const) {
      const signed = await signDecision({
        privateKey: VERIFIER_KEY,
        chainId: CHAIN_ID,
        escrowAddress: ESCROW,
        jobId: 1n,
        briefHash: ZERO_HASH,
        deliveryHash: ZERO_HASH,
        evidenceHash: ZERO_HASH,
        verdict,
      });
      expect(signed.decision.verdict).toBe(VERDICT_ENUM[verdict]);
      // 0 is the contract's `None`; a signed decision must never carry it.
      expect(signed.decision.verdict).toBeGreaterThan(0);
    }
  });

  it("does not verify against another chain id", async () => {
    const signed = await signDecision({
      privateKey: VERIFIER_KEY,
      chainId: CHAIN_ID,
      escrowAddress: ESCROW,
      jobId: 7n,
      briefHash: ZERO_HASH,
      deliveryHash: ZERO_HASH,
      evidenceHash: ZERO_HASH,
      verdict: "GO",
    });

    const recovered = await recoverTypedDataAddress({
      domain: { ...domain, chainId: 1 },
      types: DECISION_TYPES,
      primaryType: "Decision",
      message: signed.decision,
      signature: signed.signature,
    });
    expect(recovered).not.toBe(privateKeyToAccount(VERIFIER_KEY).address);
  });

  it("does not verify against another escrow deployment", async () => {
    const signed = await signDecision({
      privateKey: VERIFIER_KEY,
      chainId: CHAIN_ID,
      escrowAddress: ESCROW,
      jobId: 7n,
      briefHash: ZERO_HASH,
      deliveryHash: ZERO_HASH,
      evidenceHash: ZERO_HASH,
      verdict: "GO",
    });

    const recovered = await recoverTypedDataAddress({
      domain: { ...domain, verifyingContract: "0x000000000000000000000000000000000000dEaD" },
      types: DECISION_TYPES,
      primaryType: "Decision",
      message: signed.decision,
      signature: signed.signature,
    });
    expect(recovered).not.toBe(privateKeyToAccount(VERIFIER_KEY).address);
  });

  it("does not verify once any signed field is altered", async () => {
    const signed = await signDecision({
      privateKey: VERIFIER_KEY,
      chainId: CHAIN_ID,
      escrowAddress: ESCROW,
      jobId: 7n,
      briefHash: evaluation.briefHash,
      deliveryHash: evaluation.deliveryHash,
      evidenceHash: ZERO_HASH,
      verdict: "NO_GO",
    });

    const tampered = [
      { ...signed.decision, jobId: 8n },
      { ...signed.decision, verdict: VERDICT_ENUM.GO },
      { ...signed.decision, deliveryHash: hashContent("other delivery") },
      { ...signed.decision, validUntil: signed.decision.validUntil + 3600n },
    ];

    for (const message of tampered) {
      const recovered = await recoverTypedDataAddress({
        domain,
        types: DECISION_TYPES,
        primaryType: "Decision",
        message,
        signature: signed.signature,
      });
      expect(recovered).not.toBe(privateKeyToAccount(VERIFIER_KEY).address);
    }
  });

  it("sets a TTL inside the contract's one-hour ceiling", async () => {
    const before = BigInt(Math.floor(Date.now() / 1000));
    const signed = await signDecision({
      privateKey: VERIFIER_KEY,
      chainId: CHAIN_ID,
      escrowAddress: ESCROW,
      jobId: 1n,
      briefHash: ZERO_HASH,
      deliveryHash: ZERO_HASH,
      evidenceHash: ZERO_HASH,
      verdict: "GO",
    });

    const ttl = signed.decision.validUntil - before;
    expect(ttl).toBeGreaterThan(0n);
    expect(ttl).toBeLessThanOrEqual(3600n);
    expect(DECISION_TTL_SECONDS).toBeLessThanOrEqual(3600);
  });

  it("mirrors the payload as JSON-safe strings for transport", async () => {
    const signed = await signDecision({
      privateKey: VERIFIER_KEY,
      chainId: CHAIN_ID,
      escrowAddress: ESCROW,
      jobId: 12345678901234567890n,
      briefHash: ZERO_HASH,
      deliveryHash: ZERO_HASH,
      evidenceHash: ZERO_HASH,
      verdict: "CAUTION",
      validUntil: 1893456000n,
    });

    expect(() => JSON.stringify(signed.decisionJson)).not.toThrow();
    expect(signed.decisionJson.jobId).toBe("12345678901234567890");
    expect(signed.decisionJson.validUntil).toBe("1893456000");
  });
});

describe("content hashing", () => {
  it("matches keccak256 over UTF-8 bytes", () => {
    expect(hashContent("hello")).toBe(keccak256(toHex("hello")));
  });

  it("is whitespace- and case-sensitive, so the hash pins exact content", () => {
    expect(hashContent("hello")).not.toBe(hashContent("Hello"));
    expect(hashContent("hello")).not.toBe(hashContent("hello "));
  });
});
