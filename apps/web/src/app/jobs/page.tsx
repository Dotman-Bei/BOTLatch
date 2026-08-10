import type { Metadata } from "next";
import { JobList } from "@/components/job-list";
import { NotConfigured } from "@/components/ui";
import { ESCROW_ADDRESS } from "@/lib/config";

export const metadata: Metadata = {
  title: "Jobs — BOTLatch",
  description: "Every job on this BOTLatch deployment, with its status and verdict.",
};

export default function JobsPage() {
  return (
    <div className="container">
      <p className="eyebrow">Ledger</p>
      <h2 className="etched">Jobs</h2>
      <p className="lede" style={{ marginTop: "var(--s4)" }}>
        Every job this deployment has seen, newest first. Status and verdict are read from the
        escrow contract, not from the database — so what you see here is what the chain says.
      </p>

      <hr className="rule" />

      {ESCROW_ADDRESS ? <JobList /> : <NotConfigured />}
    </div>
  );
}
