"use client";

import Link from "next/link";
import type { Hex } from "viem";
import { useAccount } from "wagmi";
import { CopyButton } from "@/components/copy-button";
import { SettleActions } from "@/components/settle-actions";
import { AddressValue, DataRow, HashValue, Notice, TxValue } from "@/components/ui";
import { useJob } from "@/components/use-job";
import { ScoreMeter, StatusPill, VerdictBadge, statusBlurb, verdictBlurb } from "@/components/verdict";
import { addressUrl } from "@/lib/chain";
import { PUBLIC_CONFIG } from "@/lib/config";
import {
  formatBot,
  formatRelative,
  formatTimestamp,
  friendlyError,
  sameAddress,
} from "@/lib/format";

export function JobOutcome({ jobId, escrowAddress }: { jobId: string; escrowAddress: Hex }) {
  const { address } = useAccount();
  const { data, isLoading, error, isFetching } = useJob(jobId);

  if (isLoading) {
    return (
      <p className="row muted">
        <span className="spinner" aria-hidden="true" /> Loading job #{jobId}…
      </p>
    );
  }

  if (error || !data) {
    return (
      <Notice tone="error">
        {error ? friendlyError(error) : "Job not found."}{" "}
        <Link href="/">Back to the start</Link>.
      </Notice>
    );
  }

  const { job, evaluation } = data;
  const isBuyer = sameAddress(address, job.buyer);
  const isProvider = sameAddress(address, job.provider);

  // A CAUTION that the buyer has already resolved is settled; the badge should not imply a
  // pending decision.
  const verdictShown = job.verdictCode === 0 ? null : job.verdict;
  const blurb = verdictBlurb(verdictShown);

  return (
    <div className="stack">
      <header>
        <div className="row-between">
          <div>
            <p className="eyebrow">Job #{job.jobId}</p>
            <h2 className="etched">{job.title || "Untitled job"}</h2>
          </div>
          <div className="row">
            <StatusPill status={job.status} />
            {isFetching && <span className="spinner" aria-hidden="true" />}
          </div>
        </div>
        <p className="dim" style={{ marginTop: "var(--s3)" }}>
          {statusBlurb(job.status)}
        </p>
      </header>

      <section className="card card-static card-accent">
        <div className="row-between">
          <div>
            <span className="label">Escrowed</span>
            <p
              className="mono"
              style={{ fontSize: "var(--step-3)", color: "var(--accent)", margin: 0 }}
            >
              {formatBot(job.amountWei)}
            </p>
          </div>
          <VerdictBadge verdict={verdictShown} />
        </div>
        {blurb && (
          <p className="dim small" style={{ marginTop: "var(--s4)", marginBottom: 0 }}>
            {blurb}
          </p>
        )}
      </section>

      {evaluation && !evaluation.current && (
        <Notice tone="warn">
          This verdict was produced for an earlier delivery. The provider has submitted new work
          since, and it needs re-verification before the job can settle.
        </Notice>
      )}

      {job.statusCode === 1 && isProvider && (
        <Notice>
          You are the provider on this job.{" "}
          <Link href={`/jobs/${jobId}/deliver`}>Submit your delivery</Link>.
        </Notice>
      )}

      <section className="grid-2" style={{ alignItems: "start" }}>
        <div className="panel">
          <h4 style={{ marginBottom: "var(--s4)" }}>Parties</h4>
          <dl className="data-list">
            <DataRow label="Buyer">
              <AddressValue value={job.buyer} note={isBuyer ? "you" : undefined} />
            </DataRow>
            <DataRow label="Provider">
              <AddressValue value={job.provider} note={isProvider ? "you" : undefined} />
            </DataRow>
            <DataRow label="Escrow contract">
              <span className="hash">
                <a
                  className="mono"
                  href={addressUrl(job.contractAddress)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {job.contractAddress}
                </a>
                <CopyButton value={job.contractAddress} />
              </span>
            </DataRow>
            <DataRow label="Chain">
              <span className="mono">{job.chainId}</span>
            </DataRow>
            <DataRow label="Created">
              <span className="dim small">{formatTimestamp(job.createdAt)}</span>
            </DataRow>
            <DataRow label="Deadline">
              <span className="dim small">
                {formatTimestamp(job.deliverBy)} · {formatRelative(job.deliverBy)}
              </span>
            </DataRow>
          </dl>
        </div>

        <div className="panel">
          <h4 style={{ marginBottom: "var(--s4)" }}>Commitments</h4>
          <dl className="data-list">
            <DataRow label="Brief hash">
              <HashValue value={job.briefHash} />
            </DataRow>
            <DataRow label="Delivery hash">
              <HashValue value={job.deliveryHash} />
            </DataRow>
            <DataRow label="Evidence hash">
              <HashValue value={evaluation?.evidenceHash} />
            </DataRow>
            <DataRow label="Verifier">
              <AddressValue value={evaluation?.verifierAddress} />
            </DataRow>
          </dl>
          <p className="hint" style={{ marginTop: "var(--s4)" }}>
            Hash the brief or the delivery yourself with keccak256 and compare. If the text was
            altered after the fact, these will not match.
          </p>
        </div>
      </section>

      {evaluation ? (
        <section className="panel">
          <div className="row-between" style={{ marginBottom: "var(--s5)" }}>
            <h4>Why the agent decided this</h4>
            <span className="badge">{formatTimestamp(Math.floor(new Date(evaluation.createdAt).getTime() / 1000))}</span>
          </div>

          <ul className="reason-list">
            {evaluation.reasons.slice(0, 3).map((reason, index) => (
              <li key={index}>{reason}</li>
            ))}
          </ul>

          <div className="grid-2" style={{ marginTop: "var(--s6)" }}>
            <ScoreMeter label="Brief conformance" value={evaluation.conformanceScore} />
            <ScoreMeter label="Safety" value={evaluation.safetyScore} />
          </div>

          {evaluation.patternHits.length > 0 && (
            <div style={{ marginTop: "var(--s5)" }}>
              <span className="label">Patterns detected</span>
              <ul className="hit-list">
                {evaluation.patternHits.map((hit) => (
                  <li key={hit}>
                    <span className="badge badge-accent">{hit}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <details style={{ marginTop: "var(--s5)" }}>
            <summary className="small muted" style={{ cursor: "pointer" }}>
              Full evidence record (hashed on-chain)
            </summary>
            <pre
              className="mono"
              style={{
                marginTop: "var(--s3)",
                padding: "var(--s4)",
                background: "var(--bg)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius)",
                overflowX: "auto",
                whiteSpace: "pre-wrap",
              }}
            >
              {JSON.stringify(evaluation.evidence, null, 2)}
            </pre>
          </details>
        </section>
      ) : (
        job.statusCode >= 2 && (
          <Notice tone="warn">
            No evidence record is stored for this job in this deployment. The verdict on-chain is
            still authoritative; the reasoning behind it was produced elsewhere.
          </Notice>
        )
      )}

      <SettleActions jobId={jobId} escrowAddress={escrowAddress} data={data} />

      <section className="panel">
        <h4 style={{ marginBottom: "var(--s4)" }}>Transactions</h4>
        <dl className="data-list">
          <DataRow label="Job created">
            <TxValue value={job.createdTxHash} />
          </DataRow>
          <DataRow label="Delivery submitted">
            <TxValue
              value={job.deliveryTxHash}
              fallback={job.statusCode >= 2 ? "On-chain, hash not recorded here" : "Not yet"}
            />
          </DataRow>
          <DataRow label="Settlement">
            <TxValue
              value={job.decisionTxHash}
              fallback={job.statusCode === 3 || job.statusCode === 4 ? "Settled, hash not recorded here" : "Not yet"}
            />
          </DataRow>
        </dl>
        <p className="hint" style={{ marginTop: "var(--s4)" }}>
          Every transaction is public on{" "}
          <a href={PUBLIC_CONFIG.explorerUrl} target="_blank" rel="noopener noreferrer">
            BOTScan
          </a>
          . Recorded hashes are a convenience; the contract's own event log is the record.
        </p>
      </section>

      {job.brief && (
        <section>
          <div className="row-between" style={{ marginBottom: "var(--s3)" }}>
            <h4>The brief</h4>
            <CopyButton value={job.brief} label="Copy brief" />
          </div>
          <div className="card card-static">
            <p className="dim" style={{ whiteSpace: "pre-wrap", margin: 0 }}>
              {job.brief}
            </p>
          </div>
        </section>
      )}

      <Notice>
        The delivered work is never published here. Only its hash is shown, so the buyer's paid-for
        work stays private while remaining provable.
      </Notice>
    </div>
  );
}
