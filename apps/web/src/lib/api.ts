/**
 * Shared route plumbing: JSON responses, bigint-safe serialisation, internal auth, rate limiting.
 */

import "server-only";
import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { internalSecret } from "./server-env";

/** JSON.stringify replacer: bigints become decimal strings rather than throwing. */
export function jsonSafe<T>(value: T): unknown {
  return JSON.parse(JSON.stringify(value, (_key, v) => (typeof v === "bigint" ? v.toString() : v)));
}

export function ok(data: unknown, init?: ResponseInit): NextResponse {
  return NextResponse.json(jsonSafe(data), { status: 200, ...init });
}

export function fail(status: number, error: string, detail?: unknown): NextResponse {
  return NextResponse.json(jsonSafe({ error, detail }), { status });
}

/** Constant-time comparison so a wrong secret leaks no information through timing. */
function secretMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Guards internal-only routes (evaluation, the watcher tick, the chain webhook).
 *
 * These routes can spend model credits and mint signatures, so they are never public. The secret
 * arrives as `Authorization: Bearer …` or `x-internal-secret`.
 */
export function authorizeInternal(request: Request): { ok: true } | { ok: false; response: NextResponse } {
  let expected: string;
  try {
    expected = internalSecret();
  } catch {
    return { ok: false, response: fail(503, "INTERNAL_API_SECRET is not configured.") };
  }

  const header = request.headers.get("authorization") ?? "";
  const bearer = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : null;
  const provided = bearer ?? request.headers.get("x-internal-secret");

  if (!provided || !secretMatches(provided, expected)) {
    return { ok: false, response: fail(401, "Unauthorized.") };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

/**
 * Fixed-window limiter, in-process.
 *
 * Good enough for a single-instance MVP and honest about its limits: behind multiple instances
 * each one keeps its own window, so treat this as friction against casual abuse rather than a
 * guarantee. The routes it protects are all idempotent reads or re-signs of an existing verdict.
 */
export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
): { allowed: boolean; retryAfterSeconds: number } {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || now >= bucket.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    if (buckets.size > 10_000) {
      for (const [k, v] of buckets) if (now >= v.resetAt) buckets.delete(k);
    }
    return { allowed: true, retryAfterSeconds: 0 };
  }

  bucket.count += 1;
  if (bucket.count > limit) {
    return { allowed: false, retryAfterSeconds: Math.ceil((bucket.resetAt - now) / 1000) };
  }
  return { allowed: true, retryAfterSeconds: 0 };
}

export function clientKey(request: Request, scope: string): string {
  const forwarded = request.headers.get("x-forwarded-for") ?? "";
  const ip = forwarded.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "local";
  return `${scope}:${ip}`;
}

export function tooManyRequests(retryAfterSeconds: number): NextResponse {
  return NextResponse.json(
    { error: "Too many requests." },
    { status: 429, headers: { "retry-after": String(retryAfterSeconds) } },
  );
}

/** Parse a decimal job id from a route parameter. */
export function parseJobId(raw: string): bigint | null {
  if (!/^\d{1,78}$/.test(raw)) return null;
  try {
    const value = BigInt(raw);
    return value > 0n ? value : null;
  } catch {
    return null;
  }
}
