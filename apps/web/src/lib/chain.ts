import { defineChain } from "viem";

export const BOT_CHAIN_ID = 677;

/**
 * BOT Chain mainnet.
 *
 * The chain id is asserted rather than configured: a mismatch means the RPC is pointing somewhere
 * else, and every EIP-712 signature we produce is bound to 677 through the domain separator. A
 * silent fallback to another network would produce signatures the escrow can never verify.
 */
export const botChain = defineChain({
  id: BOT_CHAIN_ID,
  name: "BOT Chain",
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
  testnet: false,
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
