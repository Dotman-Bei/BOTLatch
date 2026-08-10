import { defineChain } from "viem";

/** Mainnet. What a build targets unless it is explicitly told otherwise. */
export const BOT_MAINNET_CHAIN_ID = 677;

/**
 * The chain id this build targets.
 *
 * Configurable, so the same code can be rehearsed against a testnet or a local node before it
 * touches mainnet — but never loosely. A malformed value throws at module load instead of
 * coercing to `NaN` and silently producing a chain nobody meant to talk to.
 *
 * The original assertion this replaces still holds, it has just moved: every EIP-712 signature is
 * bound to this id through the domain separator, so a build aimed at the wrong network produces
 * signatures the escrow can never verify. `scripts/verify-chain.mjs` is what enforces it now — it
 * asks the configured RPC for its actual chain id and refuses to deploy on a mismatch. Setting
 * this variable is therefore a deliberate act that the preflight re-checks against reality.
 */
function resolveChainId(): number {
  const raw = process.env.NEXT_PUBLIC_BOT_CHAIN_ID;
  if (raw === undefined || raw.trim() === "") return BOT_MAINNET_CHAIN_ID;
  const parsed = Number(raw.trim());
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(
      `NEXT_PUBLIC_BOT_CHAIN_ID must be a positive integer, got ${JSON.stringify(raw)}.`,
    );
  }
  return parsed;
}

export const BOT_CHAIN_ID = resolveChainId();

/** True for anything that is not mainnet, so the UI can say so rather than implying real value. */
export const IS_MAINNET = BOT_CHAIN_ID === BOT_MAINNET_CHAIN_ID;

export const botChain = defineChain({
  id: BOT_CHAIN_ID,
  name: IS_MAINNET ? "BOT Chain" : `BOT Chain (chain ${BOT_CHAIN_ID})`,
  nativeCurrency: { name: "BOT", symbol: "BOT", decimals: 18 },
  rpcUrls: {
    default: {
      http: [process.env.NEXT_PUBLIC_BOT_RPC_URL ?? "https://rpc.botchain.ai"],
    },
  },
  blockExplorers: {
    default: {
      name: "BOTScan",
      url: process.env.NEXT_PUBLIC_BOT_EXPLORER_URL ?? "https://scan.botchain.ai",
    },
  },
  testnet: !IS_MAINNET,
});

export const EXPLORER_URL = (
  process.env.NEXT_PUBLIC_BOT_EXPLORER_URL ?? "https://scan.botchain.ai"
).replace(/\/+$/, "");

export function txUrl(hash: string): string {
  return `${EXPLORER_URL}/tx/${hash}`;
}

export function addressUrl(address: string): string {
  return `${EXPLORER_URL}/address/${address}`;
}
