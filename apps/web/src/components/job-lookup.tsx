"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Job lookup. The outcome page is the shareable artefact of a job, and the only thing needed to
 * reach it is the job id from the `JobCreated` event — no wallet, no login.
 */
export function JobLookup() {
  const router = useRouter();
  const [jobId, setJobId] = useState("");
  const trimmed = jobId.trim();
  const valid = /^\d+$/.test(trimmed);

  return (
    <form
      className="row"
      onSubmit={(event) => {
        event.preventDefault();
        if (valid) router.push(`/jobs/${trimmed}`);
      }}
    >
      <input
        className="input"
        style={{ maxWidth: 200 }}
        inputMode="numeric"
        placeholder="Job id"
        aria-label="Job id"
        value={jobId}
        onChange={(event) => setJobId(event.target.value)}
      />
      <button type="submit" className="btn btn-ghost" disabled={!valid}>
        Open job
      </button>
    </form>
  );
}
