/**
 * File-backed store for local development and demos.
 *
 * Writes are serialised through a promise chain and land via write-to-temp-then-rename, so a crash
 * mid-write leaves the previous good file rather than a truncated one. This is deliberately not a
 * production store — set `DATABASE_URL` for that — but it must not lose a funded job's brief.
 */

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { Hex } from "viem";
import {
  jobKeyString,
  type EvaluationRecord,
  type JobKey,
  type JobRecord,
  type Store,
} from "./types";

interface FileShape {
  version: 1;
  jobs: Record<string, JobRecord>;
  evaluations: Record<string, EvaluationRecord>;
  watermarks: Record<string, string>;
}

const EMPTY: FileShape = { version: 1, jobs: {}, evaluations: {}, watermarks: {} };

export class FileStore implements Store {
  private readonly path: string;
  private cache: FileShape | null = null;
  /** Serialises every mutation; concurrent route handlers otherwise interleave read-modify-write. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(path?: string) {
    this.path = resolve(path ?? join(process.cwd(), ".data", "botlatch.json"));
  }

  private async load(): Promise<FileShape> {
    if (this.cache) return this.cache;
    try {
      const raw = await readFile(this.path, "utf8");
      const parsed = JSON.parse(raw) as FileShape;
      this.cache = { ...EMPTY, ...parsed };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") throw error;
      this.cache = structuredClone(EMPTY);
    }
    return this.cache;
  }

  private async flush(data: FileShape): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const temp = `${this.path}.${process.pid}.tmp`;
    await writeFile(temp, JSON.stringify(data, null, 2), "utf8");
    await rename(temp, this.path);
  }

  /** Run `mutate` with exclusive access to the loaded file, then persist. */
  private mutation<T>(mutate: (data: FileShape) => T | Promise<T>): Promise<T> {
    const next = this.queue.then(async () => {
      const data = await this.load();
      const result = await mutate(data);
      await this.flush(data);
      return result;
    });
    // Keep the chain alive even when one mutation rejects.
    this.queue = next.catch(() => undefined);
    return next;
  }

  async getJob(key: JobKey): Promise<JobRecord | null> {
    const data = await this.load();
    return data.jobs[jobKeyString(key)] ?? null;
  }

  async putJob(record: JobRecord): Promise<void> {
    await this.mutation((data) => {
      data.jobs[jobKeyString(record)] = record;
    });
  }

  async updateJob(key: JobKey, patch: Partial<JobRecord>): Promise<JobRecord | null> {
    return this.mutation((data) => {
      const id = jobKeyString(key);
      const existing = data.jobs[id];
      if (!existing) return null;
      const updated: JobRecord = { ...existing, ...patch, updatedAt: new Date().toISOString() };
      data.jobs[id] = updated;
      return updated;
    });
  }

  async listJobs(limit = 50): Promise<JobRecord[]> {
    const data = await this.load();
    return Object.values(data.jobs)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }

  async getEvaluation(key: JobKey): Promise<EvaluationRecord | null> {
    const data = await this.load();
    return data.evaluations[jobKeyString(key)] ?? null;
  }

  async putEvaluation(record: EvaluationRecord): Promise<void> {
    await this.mutation((data) => {
      data.evaluations[jobKeyString(record)] = record;
    });
  }

  async getWatermark(chainId: number, contractAddress: Hex): Promise<bigint | null> {
    const data = await this.load();
    const raw = data.watermarks[`${chainId}:${contractAddress.toLowerCase()}`];
    return raw ? BigInt(raw) : null;
  }

  async setWatermark(chainId: number, contractAddress: Hex, block: bigint): Promise<void> {
    await this.mutation((data) => {
      data.watermarks[`${chainId}:${contractAddress.toLowerCase()}`] = block.toString();
    });
  }
}
