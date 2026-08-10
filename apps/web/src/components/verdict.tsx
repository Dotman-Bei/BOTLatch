/**
 * Verdict and status chrome.
 *
 * The one-line explanations live here rather than in each page so that GO/CAUTION/NO_GO always
 * means the same thing to the reader, no matter where they meet it.
 */

const VERDICT_COPY: Record<string, { title: string; blurb: string; cls: string }> = {
  GO: {
    title: "GO",
    blurb:
      "The work answers the brief, and nothing in it tries to give instructions to whoever reads it next. Anyone can now settle this job to pay the provider.",
    cls: "verdict verdict-go",
  },
  CAUTION: {
    title: "CAUTION",
    blurb:
      "This could not be cleared automatically, so nothing has moved. The money stays in escrow until the buyer decides to release or refund it.",
    cls: "verdict verdict-caution",
  },
  NO_GO: {
    title: "NO_GO",
    blurb:
      "The delivery did not pass. Settling returns the full amount to the buyer, and the provider is not paid.",
    cls: "verdict verdict-no_go",
  },
};

export function VerdictBadge({
  verdict,
  statusCode,
}: {
  verdict: string | null | undefined;
  /** On-chain Status. 1 = Funded, 2 = Delivered. */
  statusCode?: number;
}) {
  const copy = verdict ? VERDICT_COPY[verdict] : undefined;
  if (!copy) {
    // A funded job has nothing to review yet. Saying "awaiting verdict" there points the reader at
    // the wrong party — it reads as though the check is running and slow, when in fact the provider
    // has not sent anything and the job will sit here indefinitely until they do.
    const waitingForDelivery = statusCode === 1;
    return (
      <span className="verdict verdict-pending">
        <span className="dot dot-pulse" aria-hidden="true" />
        {waitingForDelivery ? "Awaiting delivery" : "Awaiting verdict"}
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
  None: "No job with this number exists.",
  Funded: "The money is locked in escrow, waiting for the provider to send their work.",
  Delivered: "The work is in. BOTLatch is reviewing it and will sign a verdict.",
  Settled: "Done. The money has left escrow.",
  Cancelled: "The deadline passed with no work delivered, so the buyer was refunded.",
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
