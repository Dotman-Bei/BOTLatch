import type { Metadata } from "next";
import { CreateJobForm } from "@/components/create-job-form";
import { NotConfigured } from "@/components/ui";
import { ESCROW_ADDRESS } from "@/lib/config";

export const metadata: Metadata = {
  title: "Create a job — BOTLatch",
  description: "Lock BOT in escrow against a brief. The verification agent gates the payout.",
};

export default function CreateJobPage() {
  return (
    <div className="container">
      <p className="eyebrow">Step 1 · Fund</p>
      <h2 className="etched">Create a job</h2>
      <p className="lede" style={{ marginTop: "var(--s4)" }}>
        Write the brief, name the provider, and lock the payment. Nothing is released until a
        verification agent signs a verdict on the delivered work.
      </p>

      <hr className="rule" />

      {ESCROW_ADDRESS ? <CreateJobForm escrowAddress={ESCROW_ADDRESS} /> : <NotConfigured />}
    </div>
  );
}
