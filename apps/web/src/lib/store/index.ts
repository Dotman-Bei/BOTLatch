import "server-only";
import { databaseUrl } from "../server-env";
import { FileStore } from "./file-store";
import { PostgresStore } from "./postgres-store";
import type { Store } from "./types";

export * from "./types";

let instance: Store | null = null;

/**
 * Postgres when `DATABASE_URL` is set, otherwise a JSON file under `.data/`.
 *
 * The singleton is intentional: Next.js re-evaluates route modules per request in dev, and a new
 * connection pool per request exhausts the server's connection limit within a few page loads.
 */
export function getStore(): Store {
  if (instance) return instance;
  const url = databaseUrl();
  instance = url ? new PostgresStore(url) : new FileStore();
  return instance;
}

/** Which backend is live — surfaced in the setup notice, never in a public response. */
export function storeKind(): "postgres" | "file" {
  return databaseUrl() ? "postgres" : "file";
}
