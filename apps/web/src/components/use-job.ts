"use client";

import { useQuery } from "@tanstack/react-query";
import type { PublicEvaluation, PublicJob } from "@/lib/public-view";

export interface JobPayload {
  job: PublicJob;
  evaluation: PublicEvaluation | null;
}

async function fetchJob(jobId: string): Promise<JobPayload> {
  const response = await fetch(`/api/jobs/${jobId}`, { cache: "no-store" });
  if (!response.ok) {
    const detail = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(detail?.error ?? `Job lookup failed (${response.status}).`);
  }
  return (await response.json()) as JobPayload;
}

/**
 * Poll a job until it reaches a resting state.
 *
 * Delivered-without-a-verdict is the one genuinely transient state — the verifier is working and
 * the answer lands without any further action from the viewer — so that is the only case that
 * polls quickly. Everything else waits for the user to do something, and polling it just burns
 * their battery and our RPC quota.
 */
export function useJob(jobId: string) {
  return useQuery({
    queryKey: ["job", jobId],
    queryFn: () => fetchJob(jobId),
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data) return 5_000;
      const awaitingVerdict = data.job.statusCode === 2 && data.job.verdictCode === 0;
      return awaitingVerdict ? 4_000 : 20_000;
    },
    retry: 2,
  });
}
