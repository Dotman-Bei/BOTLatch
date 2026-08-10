/**
 * POST|GET /api/cron/tick — sweep `DeliverySubmitted` logs and evaluate what is pending.
 *
 * GET is accepted so scheduled-job runners that only issue GETs (Vercel Cron among them) work
 * without a shim. Both verbs require the internal secret.
 */

import { authorizeInternal, fail, ok } from "@/lib/api";
import { tickWatcher } from "@/lib/watcher";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function handle(request: Request) {
  const auth = authorizeInternal(request);
  if (!auth.ok) return auth.response;

  try {
    return ok(await tickWatcher());
  } catch (error) {
    console.error("[botlatch] watcher tick failed:", error);
    return fail(500, "Watcher tick failed.");
  }
}

export const POST = handle;
export const GET = handle;
