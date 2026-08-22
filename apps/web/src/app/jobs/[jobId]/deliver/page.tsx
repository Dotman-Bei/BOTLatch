import type { Metadata } from "next";
import Link from "next/link";
import { DeliverForm } from "@/components/deliver-form";
import { NotConfigured } from "@/components/ui";
import { ESCROW_ADDRESS } from "@/lib/config";

export const metadata: Metadata = {
  title: "Submit delivery · BOTLatch",
  robots: { index: false, follow: false },
};

export default async function DeliverPage({
  params,
}: {
  params: Promise<{ jobId: string }>;
}) {
  const { jobId } = await params;

  if (!/^\d+$/.test(jobId)) {
    return (
      <div className="container">
        <h2 className="etched">Invalid job id</h2>
        <p className="dim">Job ids are whole numbers. Check the link you were given.</p>
      </div>
    );
  }

  return (
    <div className="container" style={{ maxWidth: 820 }}>
      <p className="eyebrow">Step 2 · Deliver</p>
      <div className="row-between">
        <h2 className="etched">Submit work for job #{jobId}</h2>
        <Link className="btn btn-ghost btn-sm" href={`/jobs/${jobId}`}>
          View outcome
        </Link>
      </div>
      <p className="lede" style={{ marginTop: "var(--s4)" }}>
        Read the brief, paste your work, and submit. The verification agent reviews it immediately
        and its signed verdict decides whether the escrow pays out.
      </p>

      <hr className="rule" />

      {ESCROW_ADDRESS ? (
        <DeliverForm jobId={jobId} escrowAddress={ESCROW_ADDRESS} />
      ) : (
        <NotConfigured />
      )}
    </div>
  );
}
