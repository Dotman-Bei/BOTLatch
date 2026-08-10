/**
 * Postgres store.
 *
 * The schema is created on first use so a fresh `DATABASE_URL` works with no migration step. Jobs
 * are keyed by (chain_id, contract_address, job_id) rather than job_id alone: the same numeric id
 * exists on every deployment, and conflating them across a redeploy would show one job's brief
 * against another job's money.
 */

import { Pool } from "pg";
import type { Hex } from "viem";
import type { Verdict } from "@botlatch/verifier";
import type { EvaluationRecord, JobKey, JobRecord, Store } from "./types";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS jobs (
  chain_id          INTEGER      NOT NULL,
  contract_address  TEXT         NOT NULL,
  job_id            NUMERIC      NOT NULL,
  buyer_address     TEXT         NOT NULL,
  provider_address  TEXT         NOT NULL,
  title             TEXT         NOT NULL DEFAULT '',
  brief             TEXT         NOT NULL,
  brief_hash        TEXT         NOT NULL,
  delivery          TEXT,
  delivery_hash     TEXT,
  created_tx_hash   TEXT,
  delivery_tx_hash  TEXT,
  decision_tx_hash  TEXT,
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
  PRIMARY KEY (chain_id, contract_address, job_id)
);

CREATE TABLE IF NOT EXISTS evaluations (
  chain_id           INTEGER      NOT NULL,
  contract_address   TEXT         NOT NULL,
  job_id             NUMERIC      NOT NULL,
  delivery_hash      TEXT         NOT NULL,
  verdict            TEXT         NOT NULL,
  conformance_score  INTEGER      NOT NULL,
  safety_score       INTEGER      NOT NULL,
  reasons_json       JSONB        NOT NULL,
  pattern_hits_json  JSONB        NOT NULL,
  evidence_json      JSONB        NOT NULL,
  evidence_hash      TEXT         NOT NULL,
  verifier_address   TEXT         NOT NULL,
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
  PRIMARY KEY (chain_id, contract_address, job_id)
);

CREATE TABLE IF NOT EXISTS watermarks (
  chain_id          INTEGER  NOT NULL,
  contract_address  TEXT     NOT NULL,
  last_block        NUMERIC  NOT NULL,
  PRIMARY KEY (chain_id, contract_address)
);
`;

interface JobRow {
  job_id: string;
  chain_id: number;
  contract_address: string;
  buyer_address: string;
  provider_address: string;
  title: string;
  brief: string;
  brief_hash: string;
  delivery: string | null;
  delivery_hash: string | null;
  created_tx_hash: string | null;
  delivery_tx_hash: string | null;
  decision_tx_hash: string | null;
  created_at: Date;
  updated_at: Date;
}

interface EvaluationRow {
  job_id: string;
  chain_id: number;
  contract_address: string;
  delivery_hash: string;
  verdict: string;
  conformance_score: number;
  safety_score: number;
  reasons_json: string[];
  pattern_hits_json: string[];
  evidence_json: unknown;
  evidence_hash: string;
  verifier_address: string;
  created_at: Date;
}

function toJob(row: JobRow): JobRecord {
  return {
    jobId: String(row.job_id),
    chainId: row.chain_id,
    contractAddress: row.contract_address as Hex,
    buyerAddress: row.buyer_address as Hex,
    providerAddress: row.provider_address as Hex,
    title: row.title,
    brief: row.brief,
    briefHash: row.brief_hash as Hex,
    delivery: row.delivery,
    deliveryHash: row.delivery_hash as Hex | null,
    createdTxHash: row.created_tx_hash as Hex | null,
    deliveryTxHash: row.delivery_tx_hash as Hex | null,
    decisionTxHash: row.decision_tx_hash as Hex | null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function toEvaluation(row: EvaluationRow): EvaluationRecord {
  return {
    jobId: String(row.job_id),
    chainId: row.chain_id,
    contractAddress: row.contract_address as Hex,
    deliveryHash: row.delivery_hash as Hex,
    verdict: row.verdict as Verdict,
    conformanceScore: row.conformance_score,
    safetyScore: row.safety_score,
    reasons: row.reasons_json,
    patternHits: row.pattern_hits_json,
    evidence: row.evidence_json,
    evidenceHash: row.evidence_hash as Hex,
    verifierAddress: row.verifier_address as Hex,
    createdAt: row.created_at.toISOString(),
  };
}

export class PostgresStore implements Store {
  private readonly pool: Pool;
  private ready: Promise<void> | null = null;

  constructor(connectionString: string) {
    this.pool = new Pool({
      connectionString,
      max: 5,
      // Managed Postgres almost always terminates TLS with a certificate this process has no
      // root for; the connection is still encrypted.
      ssl: connectionString.includes("sslmode=disable") ? false : { rejectUnauthorized: false },
    });
  }

  private init(): Promise<void> {
    this.ready ??= this.pool.query(SCHEMA).then(() => undefined);
    return this.ready;
  }

  private args(key: JobKey): [number, string, string] {
    return [key.chainId, key.contractAddress.toLowerCase(), key.jobId];
  }

  async getJob(key: JobKey): Promise<JobRecord | null> {
    await this.init();
    const { rows } = await this.pool.query<JobRow>(
      `SELECT * FROM jobs WHERE chain_id = $1 AND contract_address = $2 AND job_id = $3`,
      this.args(key),
    );
    return rows[0] ? toJob(rows[0]) : null;
  }

  async putJob(record: JobRecord): Promise<void> {
    await this.init();
    await this.pool.query(
      `INSERT INTO jobs (chain_id, contract_address, job_id, buyer_address, provider_address,
                         title, brief, brief_hash, delivery, delivery_hash,
                         created_tx_hash, delivery_tx_hash, decision_tx_hash)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (chain_id, contract_address, job_id) DO UPDATE SET
         buyer_address = EXCLUDED.buyer_address,
         provider_address = EXCLUDED.provider_address,
         title = EXCLUDED.title,
         brief = EXCLUDED.brief,
         brief_hash = EXCLUDED.brief_hash,
         created_tx_hash = COALESCE(EXCLUDED.created_tx_hash, jobs.created_tx_hash),
         updated_at = now()`,
      [
        record.chainId,
        record.contractAddress.toLowerCase(),
        record.jobId,
        record.buyerAddress.toLowerCase(),
        record.providerAddress.toLowerCase(),
        record.title,
        record.brief,
        record.briefHash,
        record.delivery,
        record.deliveryHash,
        record.createdTxHash,
        record.deliveryTxHash,
        record.decisionTxHash,
      ],
    );
  }

  async updateJob(key: JobKey, patch: Partial<JobRecord>): Promise<JobRecord | null> {
    await this.init();
    const columns: Record<string, unknown> = {};
    if (patch.delivery !== undefined) columns.delivery = patch.delivery;
    if (patch.deliveryHash !== undefined) columns.delivery_hash = patch.deliveryHash;
    if (patch.deliveryTxHash !== undefined) columns.delivery_tx_hash = patch.deliveryTxHash;
    if (patch.decisionTxHash !== undefined) columns.decision_tx_hash = patch.decisionTxHash;
    if (patch.createdTxHash !== undefined) columns.created_tx_hash = patch.createdTxHash;
    if (patch.title !== undefined) columns.title = patch.title;

    const names = Object.keys(columns);
    if (names.length === 0) return this.getJob(key);

    const assignments = names.map((name, i) => `${name} = $${i + 4}`).join(", ");
    const { rows } = await this.pool.query<JobRow>(
      `UPDATE jobs SET ${assignments}, updated_at = now()
       WHERE chain_id = $1 AND contract_address = $2 AND job_id = $3
       RETURNING *`,
      [...this.args(key), ...names.map((name) => columns[name])],
    );
    return rows[0] ? toJob(rows[0]) : null;
  }

  async listJobs(limit = 50): Promise<JobRecord[]> {
    await this.init();
    const { rows } = await this.pool.query<JobRow>(
      `SELECT * FROM jobs ORDER BY created_at DESC LIMIT $1`,
      [limit],
    );
    return rows.map(toJob);
  }

  async getEvaluation(key: JobKey): Promise<EvaluationRecord | null> {
    await this.init();
    const { rows } = await this.pool.query<EvaluationRow>(
      `SELECT * FROM evaluations WHERE chain_id = $1 AND contract_address = $2 AND job_id = $3`,
      this.args(key),
    );
    return rows[0] ? toEvaluation(rows[0]) : null;
  }

  async putEvaluation(record: EvaluationRecord): Promise<void> {
    await this.init();
    await this.pool.query(
      `INSERT INTO evaluations (chain_id, contract_address, job_id, delivery_hash, verdict,
                                conformance_score, safety_score, reasons_json, pattern_hits_json,
                                evidence_json, evidence_hash, verifier_address)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (chain_id, contract_address, job_id) DO UPDATE SET
         delivery_hash = EXCLUDED.delivery_hash,
         verdict = EXCLUDED.verdict,
         conformance_score = EXCLUDED.conformance_score,
         safety_score = EXCLUDED.safety_score,
         reasons_json = EXCLUDED.reasons_json,
         pattern_hits_json = EXCLUDED.pattern_hits_json,
         evidence_json = EXCLUDED.evidence_json,
         evidence_hash = EXCLUDED.evidence_hash,
         verifier_address = EXCLUDED.verifier_address,
         created_at = now()`,
      [
        record.chainId,
        record.contractAddress.toLowerCase(),
        record.jobId,
        record.deliveryHash,
        record.verdict,
        record.conformanceScore,
        record.safetyScore,
        JSON.stringify(record.reasons),
        JSON.stringify(record.patternHits),
        JSON.stringify(record.evidence),
        record.evidenceHash,
        record.verifierAddress.toLowerCase(),
      ],
    );
  }

  async getWatermark(chainId: number, contractAddress: Hex): Promise<bigint | null> {
    await this.init();
    const { rows } = await this.pool.query<{ last_block: string }>(
      `SELECT last_block FROM watermarks WHERE chain_id = $1 AND contract_address = $2`,
      [chainId, contractAddress.toLowerCase()],
    );
    return rows[0] ? BigInt(rows[0].last_block) : null;
  }

  async setWatermark(chainId: number, contractAddress: Hex, block: bigint): Promise<void> {
    await this.init();
    await this.pool.query(
      `INSERT INTO watermarks (chain_id, contract_address, last_block) VALUES ($1,$2,$3)
       ON CONFLICT (chain_id, contract_address) DO UPDATE SET last_block = EXCLUDED.last_block`,
      [chainId, contractAddress.toLowerCase(), block.toString()],
    );
  }
}
