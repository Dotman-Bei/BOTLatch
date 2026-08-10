import Link from "next/link";
import { JobLookup } from "@/components/job-lookup";
import { Notice } from "@/components/ui";
import { PUBLIC_CONFIG } from "@/lib/config";

const STEPS = [
  {
    n: "01",
    title: "Fund a job",
    body: "The buyer writes a brief, names the provider's address and locks BOT in the escrow contract. Only the hash of the brief goes on-chain — the text never does.",
  },
  {
    n: "02",
    title: "Submit work",
    body: "The provider delivers, and the hash of that delivery is recorded on-chain. The verification agent reads the brief and the work, scores conformance and scans for prompt injection and exfiltration.",
  },
  {
    n: "03",
    title: "Settle safely",
    body: "The agent signs a GO, CAUTION or NO_GO decision. GO releases payment, NO_GO refunds the buyer, CAUTION holds the funds and hands the call to the buyer. Nobody can settle without a valid signature.",
  },
] as const;

export default function LandingPage() {
  return (
    <>
      <section className="hero">
        <div className="container hero-inner">
          <p className="eyebrow">BOT Chain · Escrow</p>
          <h1>
            AI-gated escrow for <span>agent work</span>.
          </h1>
          <p className="lede" style={{ marginTop: "var(--s5)" }}>
            Money moves when the work checks out. A verification agent reviews the delivery against
            the brief and signs the verdict that settles the contract — so neither side has to trust
            the other, and neither side can settle alone.
          </p>
          <div className="row" style={{ marginTop: "var(--s6)" }}>
            <Link href="/create" className="btn">
              Create a job
            </Link>
            <JobLookup />
          </div>
        </div>
      </section>

      <section className="container" style={{ marginTop: "var(--s8)" }}>
        <h2 className="etched">How it works</h2>
        <div className="grid-3" style={{ marginTop: "var(--s6)" }}>
          {STEPS.map((step) => (
            <article key={step.n} className="card card-accent">
              <p className="step-number">{step.n}</p>
              <h4 style={{ marginBlock: "var(--s4) var(--s3)" }}>{step.title}</h4>
              <p className="dim small" style={{ margin: 0 }}>
                {step.body}
              </p>
            </article>
          ))}
        </div>
      </section>

      <section className="container" style={{ marginTop: "var(--s8)" }}>
        <div className="grid-2">
          <div>
            <h3 className="etched">What the agent actually checks</h3>
            <p className="dim" style={{ marginTop: "var(--s4)" }}>
              Two layers, combined fail-safe. A deterministic pass scans the delivery for
              prompt-injection and data-exfiltration signatures — instruction overrides, system-prompt
              extraction, credential requests, encoded payloads. Then a language model judges whether
              the work answers the brief on its merits.
            </p>
            <p className="dim">
              If the model is unreachable or returns something malformed, the result is CAUTION. A
              failure in the verification path can never produce a GO.
            </p>
          </div>
          <div className="panel">
            <h4 style={{ marginBottom: "var(--s4)" }}>What goes on-chain</h4>
            <dl className="data-list">
              <div className="data-row">
                <dt>On-chain</dt>
                <dd className="small dim">
                  Escrow amount, buyer and provider addresses, brief hash, delivery hash, verdict,
                  evidence hash, verifier address.
                </dd>
              </div>
              <div className="data-row">
                <dt>Never on-chain</dt>
                <dd className="small dim">
                  The brief text, the delivered work, model prompts, model output, or any customer
                  data. Only hashes and a small public verdict record.
                </dd>
              </div>
            </dl>
          </div>
        </div>
      </section>

      <section className="container" style={{ marginTop: "var(--s8)" }}>
        {!PUBLIC_CONFIG.escrowAddress ? (
          <Notice tone="warn">
            <strong>This deployment is not configured yet.</strong> The escrow contract address is
            unset, so job creation is disabled. Deploy <code className="mono">AgentWorkEscrow</code>{" "}
            to chain {PUBLIC_CONFIG.chainId} and set{" "}
            <code className="mono">NEXT_PUBLIC_BOT_ESCROW_ADDRESS</code>.
          </Notice>
        ) : (
          <Notice>
            Escrow contract{" "}
            <a
              className="mono"
              href={`${PUBLIC_CONFIG.explorerUrl}/address/${PUBLIC_CONFIG.escrowAddress}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              {PUBLIC_CONFIG.escrowAddress}
            </a>{" "}
            on chain {PUBLIC_CONFIG.chainId}. This is unaudited MVP software handling real funds —
            use amounts you can afford to lose.
          </Notice>
        )}
      </section>
    </>
  );
}
