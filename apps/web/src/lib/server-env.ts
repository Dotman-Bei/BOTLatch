/**
 * Server-only environment access.
 *
 * Importing this module from a client component is a build error by design (`server-only`). The
 * verifier key is read lazily and never returned to a caller that only needs to know whether it is
 * present, so a misconfigured route reports "not configured" instead of leaking a key into a
 * response body or a log line.
 */

import "server-only";
import type { Hex } from "viem";

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(`${name} is not set. See .env.example.`);
  }
  return value.trim();
}

export function escrowAddress(): Hex {
  const value =
    process.env.BOT_ESCROW_ADDRESS?.trim() || process.env.NEXT_PUBLIC_BOT_ESCROW_ADDRESS?.trim();
  if (!value || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new Error("BOT_ESCROW_ADDRESS is not set to a valid address. See .env.example.");
  }
  return value as Hex;
}

export function chainId(): number {
  const parsed = Number(process.env.BOT_CHAIN_ID ?? process.env.NEXT_PUBLIC_BOT_CHAIN_ID ?? 677);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error("BOT_CHAIN_ID must be an integer.");
  return parsed;
}

export function rpcUrl(): string {
  return (
    process.env.BOT_RPC_URL?.trim() ||
    process.env.NEXT_PUBLIC_BOT_RPC_URL?.trim() ||
    "https://rpc.botchain.ai"
  );
}

/** The verifier signing key. Signs decisions; holds no funds. */
export function verifierPrivateKey(): Hex {
  const value = required("VERIFIER_PRIVATE_KEY");
  const normalized = value.startsWith("0x") ? value : `0x${value}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(normalized)) {
    throw new Error("VERIFIER_PRIVATE_KEY must be a 32-byte hex string.");
  }
  return normalized as Hex;
}

export function hasVerifierKey(): boolean {
  try {
    verifierPrivateKey();
    return true;
  } catch {
    return false;
  }
}

export function internalSecret(): string {
  return required("INTERNAL_API_SECRET");
}

export function databaseUrl(): string | null {
  const value = process.env.DATABASE_URL?.trim();
  return value && value.length > 0 ? value : null;
}

export function appUrl(): string {
  return (process.env.APP_URL?.trim() || "http://localhost:3000").replace(/\/+$/, "");
}
