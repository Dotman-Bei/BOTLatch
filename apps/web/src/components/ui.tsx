import Link from "next/link";
import { CopyButton } from "./copy-button";
import { addressUrl, txUrl } from "@/lib/chain";
import { truncateAddress, truncateHash } from "@/lib/format";

/** A 32-byte hash, truncated, with a copy button. Used for brief, delivery and evidence hashes. */
export function HashValue({ value, label }: { value: string | null | undefined; label?: string }) {
  if (!value) return <span className="muted">—</span>;
  return (
    <span className="hash">
      <code className="mono" title={value}>
        {truncateHash(value)}
      </code>
      <CopyButton value={value} label={label ?? "Copy"} />
    </span>
  );
}

/** An address, truncated, linked to BOTScan, with a copy button. */
export function AddressValue({
  value,
  note,
}: {
  value: string | null | undefined;
  note?: string;
}) {
  if (!value) return <span className="muted">—</span>;
  return (
    <span className="hash">
      <a className="mono" href={addressUrl(value)} target="_blank" rel="noopener noreferrer" title={value}>
        {truncateAddress(value)}
      </a>
      {note && <span className="small muted">{note}</span>}
      <CopyButton value={value} />
    </span>
  );
}

/** A transaction hash, linked to BOTScan. Renders the fallback when the hash is not known. */
export function TxValue({
  value,
  fallback = "Not recorded",
}: {
  value: string | null | undefined;
  fallback?: string;
}) {
  if (!value) return <span className="muted">{fallback}</span>;
  return (
    <span className="hash">
      <a className="mono" href={txUrl(value)} target="_blank" rel="noopener noreferrer" title={value}>
        {truncateHash(value)}
      </a>
      <CopyButton value={value} />
    </span>
  );
}

/** One row of the definition list used on the outcome page. */
export function DataRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="data-row">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export function Notice({
  tone = "default",
  children,
}: {
  tone?: "default" | "warn" | "error" | "ok";
  children: React.ReactNode;
}) {
  const cls = tone === "default" ? "notice" : `notice notice-${tone}`;
  return <div className={cls}>{children}</div>;
}

/**
 * Shown wherever the app needs a deployed escrow and does not have one. This is a configuration
 * problem, not a user error, so it says exactly which variable is missing.
 */
export function NotConfigured() {
  return (
    <Notice tone="warn">
      <strong>Not configured.</strong> Set <code className="mono">NEXT_PUBLIC_BOT_ESCROW_ADDRESS</code>{" "}
      to the deployed <code className="mono">AgentWorkEscrow</code> address and restart the app. See{" "}
      <Link href="/">the deployment checklist in the README</Link>.
    </Notice>
  );
}
