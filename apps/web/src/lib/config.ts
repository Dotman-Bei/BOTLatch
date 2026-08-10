/**
 * Client-safe configuration.
 *
 * Everything here is inlined into the browser bundle at build time, so it may only contain public
 * values: RPC endpoints, the explorer origin, the chain id and the deployed escrow address. The
 * deployer key, the verifier key, the model key and the database URL live in `server-env.ts` and
 * must never be imported from a client component.
 */

import { BOT_CHAIN_ID } from "./chain";

function readAddress(value: string | undefined): `0x${string}` | null {
  if (!value) return null;
  const trimmed = value.trim();
  return /^0x[0-9a-fA-F]{40}$/.test(trimmed) ? (trimmed as `0x${string}`) : null;
}

export const ESCROW_ADDRESS = readAddress(process.env.NEXT_PUBLIC_BOT_ESCROW_ADDRESS);

export const PUBLIC_CONFIG = {
  // Straight from `chain.ts`, not re-read from the environment. Parsing it twice is how the wagmi
  // chain object and this config drifted apart: one honoured the override and the other did not.
  chainId: BOT_CHAIN_ID,
  rpcUrl: process.env.NEXT_PUBLIC_BOT_RPC_URL ?? "https://rpc.botchain.ai",
  explorerUrl: process.env.NEXT_PUBLIC_BOT_EXPLORER_URL ?? "https://scan.botchain.ai",
  escrowAddress: ESCROW_ADDRESS,
} as const;

/** Maximum brief length, per the MVP spec. Enforced in the browser and again on the server. */
export const MAX_BRIEF_CHARS = 10_000;

/**
 * Delivery bounds, mirrored from `@botlatch/verifier`.
 *
 * They are re-declared rather than imported because importing them would pull the verifier — LLM
 * client included — into the browser bundle to read two numbers. These copies drive UI hints only;
 * the server validates against the verifier's own constants, and the delivery route asserts at
 * module load that the two agree, so drift fails loudly rather than silently.
 */
export const MAX_DELIVERY_CHARS = 60_000;
export const MIN_DELIVERY_CHARS = 40;

/**
 * Deployment gate. Until the escrow address is configured the app renders a setup notice instead
 * of wallet buttons that would silently target `undefined`.
 */
export function isConfigured(): boolean {
  return ESCROW_ADDRESS !== null;
}

export function requireEscrowAddress(): `0x${string}` {
  if (!ESCROW_ADDRESS) {
    throw new Error(
      "NEXT_PUBLIC_BOT_ESCROW_ADDRESS is not set. Deploy AgentWorkEscrow and set it in .env.local.",
    );
  }
  return ESCROW_ADDRESS;
}
