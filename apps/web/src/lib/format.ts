/**
 * Display helpers shared by the four screens.
 *
 * These are presentation-only and safe on both sides of the client boundary — no env access, no
 * secrets, no chain calls.
 */

import { formatUnits, type Hex } from "viem";

/** `0x1234…abcd` — the standard truncation used everywhere an address is shown. */
export function truncateAddress(address: string | null | undefined, lead = 6, tail = 4): string {
  if (!address) return "—";
  if (address.length <= lead + tail + 1) return address;
  return `${address.slice(0, lead)}…${address.slice(-tail)}`;
}

/** Same idea for 32-byte hashes, which are too long to show whole in a table cell. */
export function truncateHash(hash: string | null | undefined): string {
  return truncateAddress(hash, 10, 8);
}

/**
 * Wei to a human BOT amount. Trailing zeros are dropped so `1.500000000000000000` shows as `1.5`,
 * but the value is never rounded — an escrow UI that displays a different number than it moves is
 * worse than an ugly one.
 */
export function formatBot(wei: bigint | string, symbol = "BOT"): string {
  const value = typeof wei === "bigint" ? wei : BigInt(wei || "0");
  const raw = formatUnits(value, 18);
  const trimmed = raw.includes(".") ? raw.replace(/\.?0+$/, "") : raw;
  return `${trimmed || "0"} ${symbol}`;
}

/** Unix seconds to a locale date-time. Returns "—" for the zero timestamp. */
export function formatTimestamp(seconds: number | null | undefined): string {
  if (!seconds) return "—";
  return new Date(seconds * 1000).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/** "in 3 days" / "2 hours ago", for deadlines where the absolute date means little on its own. */
export function formatRelative(seconds: number | null | undefined, now = Date.now()): string {
  if (!seconds) return "—";
  const deltaMs = seconds * 1000 - now;
  const abs = Math.abs(deltaMs);
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ["day", 86_400_000],
    ["hour", 3_600_000],
    ["minute", 60_000],
    ["second", 1000],
  ];
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  for (const [unit, ms] of units) {
    if (abs >= ms || unit === "second") {
      return formatter.format(Math.round(deltaMs / ms), unit);
    }
  }
  return "—";
}

export function isExpired(deliverBy: number, now = Date.now()): boolean {
  return deliverBy > 0 && deliverBy * 1000 <= now;
}

export function isHex32(value: string): value is Hex {
  return /^0x[0-9a-fA-F]{64}$/.test(value);
}

export function isAddress(value: string): value is Hex {
  return /^0x[0-9a-fA-F]{40}$/.test(value);
}

export function sameAddress(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  return a.toLowerCase() === b.toLowerCase();
}

/**
 * Turn a wallet/RPC error into one line a person can act on.
 *
 * Wallet errors arrive as multi-paragraph dumps with request bodies and stack traces attached;
 * pasting that into the UI hides the one sentence that matters.
 */
export function friendlyError(error: unknown): string {
  if (!error) return "Something went wrong.";
  const message =
    error instanceof Error ? error.message : typeof error === "string" ? error : String(error);

  if (/user rejected|user denied|rejected the request/i.test(message)) {
    return "You rejected the request in your wallet.";
  }
  if (/insufficient funds/i.test(message)) {
    return "Not enough BOT in your wallet to cover the amount plus gas.";
  }
  if (/chain.*mismatch|does not match the target chain|unsupported chain/i.test(message)) {
    return "Your wallet is on the wrong network. Switch to BOT Chain and try again.";
  }
  if (/InvalidSignature/.test(message)) {
    return "The contract rejected the verifier signature. The deployed verifier address and the app's signing key disagree.";
  }
  if (/DecisionExpired/.test(message)) {
    return "That decision expired before it was submitted. Reload the page to fetch a fresh one.";
  }
  if (/InvalidStatus/.test(message)) {
    return "The job is no longer in the state this action expects. Reload the page.";
  }
  if (/NotBuyer|NotProvider|NotParticipant/.test(message)) {
    return "Your connected wallet is not permitted to take this action on this job.";
  }

  // viem puts the useful sentence first and the request dump after a blank line.
  const firstParagraph = message.split("\n\n")[0] ?? message;
  return firstParagraph.length > 240 ? `${firstParagraph.slice(0, 240)}…` : firstParagraph;
}
