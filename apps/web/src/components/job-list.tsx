"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useAccount } from "wagmi";
import { Notice } from "@/components/ui";
import { StatusPill, VerdictBadge } from "@/components/verdict";
import type { PublicJob } from "@/lib/public-view";
import { formatBot, formatRelative, sameAddress, truncateAddress } from "@/lib/format";

type Filter = "all" | "mine";

/**
 * Every job this deployment knows about, newest first.
 *
 * Status and verdict come from the escrow rather than the database, so a row can never claim a job
 * settled that the chain still holds open. The "mine" filter is client-side because which wallet is
 * connected is a browser fact — the server has no session and deliberately keeps none.
 */
export function JobList() {
  const { address } = useAccount();
  const [filter, setFilter] = useState<Filter>("all");

  const { data, isLoading, error } = useQuery({
    queryKey: ["jobs"],
    queryFn: async () => {
      const response = await fetch("/api/jobs?limit=50");
      if (!response.ok) throw new Error("Could not load jobs.");
      return (await response.json()) as { jobs: PublicJob[] };
    },
    refetchInterval: 15_000,
  });

  if (isLoading) {
    return (
      <p className="row muted">
        <span className="spinner" aria-hidden="true" /> Loading jobs…
      </p>
    );
  }

  if (error) return <Notice tone="error">Could not load jobs.</Notice>;

  const all = data?.jobs ?? [];
  const mine = address
    ? all.filter((job) => sameAddress(address, job.buyer) || sameAddress(address, job.provider))
    : [];
  const shown = filter === "mine" ? mine : all;

  return (
    <div className="stack">
      <div className="row-between">
        <div className="row" style={{ gap: "var(--s2)" }}>
          <button
            type="button"
            className={filter === "all" ? "btn btn-sm btn-pill" : "btn btn-sm btn-pill btn-ghost"}
            onClick={() => setFilter("all")}
          >
            All jobs ({all.length})
          </button>
          <button
            type="button"
            className={filter === "mine" ? "btn btn-sm btn-pill" : "btn btn-sm btn-pill btn-ghost"}
            onClick={() => setFilter("mine")}
            disabled={!address}
            title={address ? undefined : "Connect a wallet to filter to your own jobs"}
          >
            Mine ({mine.length})
          </button>
        </div>
        <Link href="/create" className="btn btn-sm">
          Create a job
        </Link>
      </div>

      {shown.length === 0 ? (
        <Notice>
          {filter === "mine"
            ? "None of the jobs here involve the connected wallet."
            : "No jobs yet. Create one to get started."}
        </Notice>
      ) : (
        <div className="stack-tight">
          {shown.map((job) => {
            const isBuyer = sameAddress(address, job.buyer);
            const isProvider = sameAddress(address, job.provider);
            return (
              <Link key={job.jobId} href={`/jobs/${job.jobId}`} className="job-row">
                <span className="job-row-id mono">#{job.jobId}</span>

                <span className="job-row-main">
                  <span className="job-row-title">{job.title || "Untitled job"}</span>
                  <span className="job-row-meta small muted">
                    {isBuyer && <span className="job-row-role">you buy</span>}
                    {isProvider && <span className="job-row-role">you deliver</span>}
                    <span>
                      {truncateAddress(job.buyer)} → {truncateAddress(job.provider)}
                    </span>
                    <span>{formatRelative(job.createdAt)}</span>
                  </span>
                </span>

                <span className="job-row-amount mono">{formatBot(job.amountWei)}</span>

                <span className="job-row-state">
                  <StatusPill status={job.status} />
                  <VerdictBadge
                    verdict={job.verdictCode === 0 ? null : job.verdict}
                    statusCode={job.statusCode}
                  />
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
