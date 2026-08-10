"use client";

/**
 * Route-level error boundary.
 *
 * The message is shown as-is because these are our own errors, not user input — but it is the only
 * thing shown: stack traces belong in the server log, not on a page that anyone with a job link
 * can open.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="container" style={{ maxWidth: 640 }}>
      <p className="eyebrow">Error</p>
      <h2 className="etched">That did not work</h2>
      <p className="lede" style={{ marginTop: "var(--s4)" }}>
        {error.message || "Something went wrong loading this page."}
      </p>
      <div className="row" style={{ marginTop: "var(--s6)" }}>
        <button type="button" className="btn" onClick={reset}>
          Try again
        </button>
        <a className="btn btn-ghost" href="/">
          Back to the start
        </a>
      </div>
      {error.digest && (
        <p className="hint" style={{ marginTop: "var(--s5)" }}>
          Reference <code className="mono">{error.digest}</code>
        </p>
      )}
    </div>
  );
}
