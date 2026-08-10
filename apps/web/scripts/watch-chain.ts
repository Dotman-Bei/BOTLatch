/**
 * Standalone delivery watcher.
 *
 *   npm run watch:chain --workspace @botlatch/web
 *
 * Drives `POST /api/cron/tick` on a running BOTLatch server, which sweeps `DeliverySubmitted` logs
 * and evaluates anything still without a verdict. Use this in development, or anywhere the host has
 * no cron; in production either this or a scheduled call to the same endpoint should be running,
 * never both against the same database.
 *
 * It deliberately calls the endpoint rather than importing `lib/watcher` directly. Two reasons, and
 * both are load-bearing:
 *
 *   1. `lib/watcher` imports `server-only`, which resolves to a module that throws outside the
 *      `react-server` condition. A plain Node process importing it crashes on the first line.
 *   2. Only one process should hold the verifier signing key. That process is the server. A watcher
 *      that reached into the same modules would need the key too, and would be a second place for
 *      it to leak from.
 *
 * So this file holds no key, opens no RPC connection, and talks to nothing but the app.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

/**
 * Load `.env` / `.env.local` by hand.
 *
 * Next.js does this for the server; this process is plain Node and nothing has populated
 * `process.env` for us. An explicit shell variable always wins over the file, matching Next's own
 * precedence, so `INTERNAL_API_SECRET=… npm run watch:chain` behaves the way it looks like it does.
 */
function loadEnvFiles(): void {
  for (const file of [".env", ".env.local"]) {
    let text: string;
    try {
      text = readFileSync(resolve(ROOT, file), "utf8");
    } catch {
      continue;
    }
    for (const line of text.split(/\r?\n/)) {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
      if (!match) continue;
      const key = match[1] as string;
      const rawValue = match[2] ?? "";
      if (process.env[key] !== undefined && process.env[key] !== "") continue;
      process.env[key] = rawValue.trim().replace(/^["']|["']$/g, "");
    }
  }
}

loadEnvFiles();

const INTERVAL_MS = Number(process.env.WATCH_INTERVAL_MS ?? 12_000);
const APP_URL = (process.env.APP_URL?.trim() || "http://localhost:3000").replace(/\/+$/, "");
const SECRET = process.env.INTERNAL_API_SECRET?.trim();

if (!SECRET) {
  console.error(
    "INTERNAL_API_SECRET is not set. The tick endpoint is authenticated; set it in .env (the same\n" +
      "value the server is running with) or export it before starting the watcher.",
  );
  process.exit(1);
}

if (!Number.isFinite(INTERVAL_MS) || INTERVAL_MS < 1000) {
  console.error("WATCH_INTERVAL_MS must be a number of milliseconds >= 1000.");
  process.exit(1);
}

interface TickResponse {
  fromBlock?: string;
  toBlock?: string;
  found?: number;
  evaluated?: string[];
  failed?: Array<{ jobId: string; error: string }>;
  error?: string;
}

let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    stopping = true;
    console.log(`\n[watcher] ${signal} received, finishing the current tick.`);
  });
}

async function tick(): Promise<void> {
  // A tick that outlives the poll interval means the server is wedged or the RPC is crawling;
  // abandoning it is better than stacking overlapping sweeps against the same watermark.
  const controller = new AbortController();
  const abort = setTimeout(() => controller.abort(), Math.max(INTERVAL_MS * 2, 30_000));

  try {
    const response = await fetch(`${APP_URL}/api/cron/tick`, {
      method: "POST",
      headers: { authorization: `Bearer ${SECRET}` },
      signal: controller.signal,
    });

    const body = (await response.json().catch(() => null)) as TickResponse | null;

    if (!response.ok) {
      console.error(
        `[watcher] tick returned ${response.status}: ${body?.error ?? response.statusText}`,
      );
      return;
    }

    const found = body?.found ?? 0;
    const evaluated = body?.evaluated ?? [];
    if (found > 0 || evaluated.length > 0) {
      console.log(
        `[watcher] blocks ${body?.fromBlock ?? "?"}-${body?.toBlock ?? "?"}: ` +
          `${found} event(s), ${evaluated.length} evaluated`,
      );
    }
    for (const failure of body?.failed ?? []) {
      console.error(`[watcher] job ${failure.jobId} failed: ${failure.error}`);
    }
  } finally {
    clearTimeout(abort);
  }
}

async function main(): Promise<void> {
  console.log(`[watcher] polling ${APP_URL}/api/cron/tick every ${INTERVAL_MS}ms. Ctrl-C to stop.`);

  while (!stopping) {
    try {
      await tick();
    } catch (error) {
      // Keep polling. The server restarting, or an RPC hiccup behind it, should not end this
      // process and leave deliveries sitting unverified.
      console.error("[watcher] tick failed:", error instanceof Error ? error.message : error);
    }
    if (!stopping) await sleep(INTERVAL_MS);
  }

  console.log("[watcher] stopped.");
}

void main();
