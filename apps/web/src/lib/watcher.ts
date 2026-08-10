/**
 * DeliverySubmitted watcher.
 *
 * The provider's browser tells us about a delivery, but a browser can close mid-request, and a
 * provider script may never call the API at all. The chain is the only account of what happened
 * that cannot go missing, so a poller sweeps `DeliverySubmitted` logs and evaluates anything that
 * still has no verdict.
 *
 * A watermark per (chain, deployment) keeps each tick bounded. It is deliberately rewound a few
 * blocks each pass: re-evaluating is idempotent, whereas a reorg that moves a log past an
 * already-advanced watermark would drop a job on the floor permanently.
 */

import "server-only";
import { parseAbiItem, type Hex } from "viem";
import { publicClient } from "./chain-server";
import { evaluateJob } from "./evaluation-service";
import { chainId, escrowAddress } from "./server-env";
import { getStore } from "./store";

const DELIVERY_SUBMITTED = parseAbiItem(
  "event DeliverySubmitted(uint256 indexed jobId, bytes32 deliveryHash)",
);

/** Blocks to re-scan on every tick, so a shallow reorg cannot hide a delivery. */
const REORG_BUFFER = 12n;

/** Upper bound per tick. Keeps a cold start from asking the RPC for the whole chain at once. */
const MAX_RANGE = 5_000n;

export interface TickResult {
  fromBlock: string;
  toBlock: string;
  found: number;
  evaluated: string[];
  skipped: Array<{ jobId: string; reason: string }>;
  failed: Array<{ jobId: string; error: string }>;
}

export async function tickWatcher(): Promise<TickResult> {
  const client = publicClient();
  const address = escrowAddress() as Hex;
  const store = getStore();
  const id = chainId();

  const head = await client.getBlockNumber();
  const stored = await store.getWatermark(id, address);

  // Cold start: look back one range rather than replaying the chain from genesis. Anything older
  // can still be evaluated by hand through POST /api/jobs/:jobId/evaluate.
  const start = stored === null ? (head > MAX_RANGE ? head - MAX_RANGE : 0n) : stored;
  const fromBlock = start > REORG_BUFFER ? start - REORG_BUFFER : 0n;
  const toBlock = fromBlock + MAX_RANGE < head ? fromBlock + MAX_RANGE : head;

  const logs = await client.getLogs({
    address,
    event: DELIVERY_SUBMITTED,
    fromBlock,
    toBlock,
  });

  const result: TickResult = {
    fromBlock: fromBlock.toString(),
    toBlock: toBlock.toString(),
    found: logs.length,
    evaluated: [],
    skipped: [],
    failed: [],
  };

  // Deduplicate: a re-delivery emits the event twice for the same job, and only the current
  // on-chain delivery hash matters.
  const jobIds = [...new Set(logs.map((log) => log.args.jobId).filter((v): v is bigint => v !== undefined))];

  for (const jobId of jobIds) {
    try {
      const outcome = await evaluateJob(jobId);
      if (outcome.status === "evaluated") result.evaluated.push(jobId.toString());
      else if (outcome.status === "skipped") {
        result.skipped.push({ jobId: jobId.toString(), reason: outcome.reason });
      }
    } catch (error) {
      // One bad job must not stall the sweep — and must not advance past the others either, so
      // the watermark still moves and the failure is reported for an operator to re-run.
      result.failed.push({
        jobId: jobId.toString(),
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  await store.setWatermark(id, address, toBlock);
  return result;
}
