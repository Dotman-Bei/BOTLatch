/**
 * GET /api/health — deployment self-check.
 *
 * Reports whether each moving part is configured and whether the verifier address the app would
 * sign with matches the `verifierSigner` the contract will actually accept. A mismatch there is
 * the single most likely deployment mistake: every signature verifies locally and every `settle`
 * call reverts with `InvalidSignature`.
 *
 * Booleans and public addresses only — never a key, never a connection string.
 */

import { privateKeyToAccount } from "viem/accounts";
import { ok } from "@/lib/api";
import { readJobCount, readVerifierSigner } from "@/lib/chain-server";
import { chainId, escrowAddress, hasVerifierKey, verifierPrivateKey } from "@/lib/server-env";
import { storeKind } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const checks: Record<string, unknown> = {
    chainId: null,
    escrowAddress: null,
    verifierKeyConfigured: hasVerifierKey(),
    llmKeyConfigured: Boolean(process.env.LLM_API_KEY?.trim()),
    internalSecretConfigured: Boolean(process.env.INTERNAL_API_SECRET?.trim()),
    store: storeKind(),
    chainReachable: false,
    verifierMatchesContract: null,
  };

  try {
    checks.chainId = chainId();
    checks.escrowAddress = escrowAddress();
  } catch (error) {
    checks.configError = error instanceof Error ? error.message : String(error);
    return ok(checks);
  }

  try {
    const [onChainSigner, jobCount] = await Promise.all([readVerifierSigner(), readJobCount()]);
    checks.chainReachable = true;
    checks.jobCount = jobCount.toString();
    checks.contractVerifierSigner = onChainSigner;

    if (hasVerifierKey()) {
      const local = privateKeyToAccount(verifierPrivateKey()).address;
      checks.localVerifierAddress = local;
      checks.verifierMatchesContract = local.toLowerCase() === onChainSigner.toLowerCase();
    }
  } catch (error) {
    checks.chainError = error instanceof Error ? error.message : String(error);
  }

  return ok(checks);
}
