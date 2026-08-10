/**
 * The verification pipeline.
 *
 *   1. Validate payload size and hash it.
 *   2. Normalize text; decode base64, hex, Unicode escapes, zero-width characters.
 *   3. Run deterministic injection signatures.
 *   4. Ask the LLM for conformance + safety.
 *   5. Combine both layers with fail-safe rules.
 *   6. Build evidence, hash it, sign the EIP-712 decision.
 */

import type { Address, Hex } from "viem";
import { assessWithLlm, llmConfigFromEnv, type LlmConfig } from "./llm.js";
import { MAX_DELIVERY_CHARS, runDeterministicChecks } from "./patterns.js";
import { decide, toEvaluation } from "./policy.js";
import { buildEvidence, hashContent, hashEvidence, signDecision } from "./sign.js";
import type { LlmAssessment, VerificationResult } from "./types.js";

export interface VerifyArgs {
  jobId: bigint;
  chainId: number;
  escrowAddress: Address;
  brief: string;
  delivery: string;
  /** Verifier signing key. Server-side only — never expose to a browser. */
  verifierPrivateKey: Hex;
  /** Defaults to configuration read from process.env. */
  llmConfig?: LlmConfig;
  /** Override for deterministic tests. */
  now?: Date;
  validUntil?: bigint;
}

export class DeliveryTooLargeError extends Error {
  constructor(length: number) {
    super(`Delivery is ${length} characters; the limit is ${MAX_DELIVERY_CHARS}.`);
    this.name = "DeliveryTooLargeError";
  }
}

export class HashMismatchError extends Error {
  constructor(field: "brief" | "delivery", expected: Hex, actual: Hex) {
    super(`${field} hash mismatch: expected ${expected}, computed ${actual}`);
    this.name = "HashMismatchError";
  }
}

/**
 * Evaluate a delivery and produce a signed, settlement-ready decision.
 *
 * Throws only on operator error (oversized payload, bad key). Every *evaluation* failure —
 * including a completely unavailable model — resolves to a signed CAUTION or NO_GO, never to
 * an exception that would leave the job stuck.
 */
export async function verifyDelivery(args: VerifyArgs): Promise<VerificationResult> {
  const { brief, delivery } = args;

  if (delivery.length > MAX_DELIVERY_CHARS) throw new DeliveryTooLargeError(delivery.length);

  // 1 — hash exactly what was evaluated.
  const briefHash = hashContent(brief);
  const deliveryHash = hashContent(delivery);

  // 2 + 3 — normalization, decoding, deterministic signatures.
  const deterministic = runDeterministicChecks(delivery);

  // 4 — semantic layer. Skipped when the deterministic layer has already found blocking
  //     evidence: the verdict cannot change, and there is no reason to send hostile content
  //     to a model or to pay for the call.
  const llmConfig = args.llmConfig ?? llmConfigFromEnv();
  const llm: LlmAssessment = deterministic.passed
    ? await assessWithLlm(brief, delivery, llmConfig)
    : {
        conformance: "fail",
        safety: "hostile",
        reasons: ["Blocked by deterministic safety screening before semantic review."],
        ok: true,
        model: `${llmConfig.model} (skipped: deterministic block)`,
        modelOutputHash: hashContent(""),
      };

  // 5 — fail-safe combination.
  const policy = decide({
    deterministic,
    llm,
    deliveryLength: delivery.trim().length,
  });

  const evaluation = toEvaluation(
    policy,
    deterministic,
    llm,
    { briefHash, deliveryHash },
    (args.now ?? new Date()).toISOString(),
  );

  // 6 — evidence, hash, signature.
  const evidence = buildEvidence({
    jobId: args.jobId,
    chainId: args.chainId,
    escrowAddress: args.escrowAddress,
    evaluation,
    deterministic,
    llm,
  });
  const evidenceHash = hashEvidence(evidence);

  const signed = await signDecision({
    privateKey: args.verifierPrivateKey,
    chainId: args.chainId,
    escrowAddress: args.escrowAddress,
    jobId: args.jobId,
    briefHash,
    deliveryHash,
    evidenceHash,
    verdict: evaluation.verdict,
    validUntil: args.validUntil,
  });

  return { evaluation, evidence, evidenceHash, deterministic, llm, signed };
}

/**
 * Guard used by the API before signing: the content we are about to evaluate must be the exact
 * content the provider committed to on-chain. Without this, a server-side content swap could
 * produce a valid signature over a delivery nobody agreed to.
 */
export function assertHashesMatch(
  brief: string,
  delivery: string,
  onChain: { briefHash: Hex; deliveryHash: Hex },
): void {
  const computedBrief = hashContent(brief);
  if (computedBrief.toLowerCase() !== onChain.briefHash.toLowerCase()) {
    throw new HashMismatchError("brief", onChain.briefHash, computedBrief);
  }
  const computedDelivery = hashContent(delivery);
  if (computedDelivery.toLowerCase() !== onChain.deliveryHash.toLowerCase()) {
    throw new HashMismatchError("delivery", onChain.deliveryHash, computedDelivery);
  }
}
