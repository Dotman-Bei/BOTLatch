/**
 * Verdict and status chrome.
 *
 * The one-line explanations live here rather than in each page so that GO/CAUTION/NO_GO always
 * means the same thing to the reader, no matter where they meet it.
 */

const VERDICT_COPY: Record<string, { title: string; blurb: string; cls: string }> = {
  GO: {
    title: "GO",
    blurb: "The work matches the brief and no injection or exfiltration patterns were found. Anyone can settle this job to release payment to the provider.",
    cls: "verdict verdict-go",
  },
  CAUTION: {
    title: "CAUTION",
    blurb: "The verifier could not clear this automatically. Funds stay locked in escrow until the buyer decides. Nothing has moved yet.",
    cls: "verdict verdict-caution",
  },
  NO_GO: {
    title: "NO_GO",
    blurb: "The delivery failed verification. Settling refunds the buyer in full; the provider is not paid.",
    cls: "verdict verdict-no_go",
  },
};

export function VerdictBadge({ verdict }: { verdict: string | null | undefined }) {
  const copy = verdict ? VERDICT_COPY[verdict] : undefined;
  if (!copy) {
    return (
      <span className="verdict verdict-pending">
        <span className="dot dot-pulse" aria-hidden="true" />
        Awaiting verdict
      </span>
    );
  }
  return (
    <span className={copy.cls}>
      <span className="dot" aria-hidden="true" />
      {copy.title}
    </span>
  );
}

export function verdictBlurb(verdict: string | null | undefined): string | null {
  return verdict ? (VERDICT_COPY[verdict]?.blurb ?? null) : null;
}

const STATUS_COPY: Record<string, string> = {
  None: "This job id does not exist on the escrow.",
  Funded: "Funds are locked in escrow. Waiting for the provider to submit the delivery.",
  Delivered: "The delivery is on-chain. The verifier reviews it and signs a decision.",
  Settled: "Settled. Funds have left escrow.",
  Cancelled: "Cancelled after the deadline passed with no delivery. The buyer was refunded.",
};

export function StatusPill({ status }: { status: string }) {
  return (
    <span className="badge" title={STATUS_COPY[status] ?? status}>
      {status}
    </span>
  );
}

export function statusBlurb(status: string): string {
  return STATUS_COPY[status] ?? "";
}

/** 0–100 confidence bar. Green above 80, red below 50, accent between. */
export function ScoreMeter({ label, value }: { label: string; value: number }) {
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  const tone = pct >= 80 ? "good" : pct < 50 ? "bad" : "";
  return (
    <div>
      <div className="row-between" style={{ marginBottom: "var(--s2)" }}>
        <span className="label" style={{ marginBottom: 0 }}>
          {label}
        </span>
        <span className="mono">{pct}</span>
      </div>
      <div
        className="meter"
        role="meter"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
      >
        <div className={`meter-fill ${tone}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
