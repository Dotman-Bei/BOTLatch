import type { Metadata } from "next";
import Link from "next/link";
import { JobOutcome } from "@/components/job-outcome";
import { NotConfigured } from "@/components/ui";
import { ESCROW_ADDRESS } from "@/lib/config";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ jobId: string }>;
}): Promise<Metadata> {
  const { jobId } = await params;
  return {
    title: `Job #${jobId} · BOTLatch`,
    description: "Escrow state, verification verdict and settlement for a BOTLatch job.",
  };
}

export default async function JobPage({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;

  if (!/^\d+$/.test(jobId)) {
    return (
      <div className="container">
        <h2 className="etched">Invalid job id</h2>
        <p className="dim">
          Job ids are whole numbers. <Link href="/">Back to the start</Link>.
        </p>
      </div>
    );
  }

  return (
    <div className="container" style={{ maxWidth: 900 }}>
      {ESCROW_ADDRESS ? (
        <JobOutcome jobId={jobId} escrowAddress={ESCROW_ADDRESS} />
      ) : (
        <NotConfigured />
      )}
    </div>
  );
}
