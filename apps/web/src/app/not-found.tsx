import Link from "next/link";

export default function NotFound() {
  return (
    <div className="container" style={{ maxWidth: 640 }}>
      <p className="eyebrow">404</p>
      <h2 className="etched">Nothing here</h2>
      <p className="lede" style={{ marginTop: "var(--s4)" }}>
        That page does not exist. Jobs live at <code className="mono">/jobs/&lt;id&gt;</code>.
      </p>
      <div className="row" style={{ marginTop: "var(--s6)" }}>
        <Link href="/" className="btn">
          Back to the start
        </Link>
        <Link href="/create" className="btn btn-ghost">
          Create a job
        </Link>
      </div>
    </div>
  );
}
