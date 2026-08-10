/**
 * ABI for AgentWorkEscrow.
 *
 * Hand-maintained and kept in step with `packages/contracts/src/AgentWorkEscrow.sol`. Only the
 * entry points and events the app actually uses appear here; the contract is the source of truth,
 * and `npm run test:contracts` is what proves the two agree.
 */
export const AGENT_WORK_ESCROW_ABI = [
  // --- writes ---------------------------------------------------------------
  {
    type: "function",
    name: "createJob",
    stateMutability: "payable",
    inputs: [
      { name: "provider", type: "address" },
      { name: "briefHash", type: "bytes32" },
      { name: "deliverBy", type: "uint64" },
    ],
    outputs: [{ name: "jobId", type: "uint256" }],
  },
  {
    type: "function",
    name: "submitDelivery",
    stateMutability: "nonpayable",
    inputs: [
      { name: "jobId", type: "uint256" },
      { name: "deliveryHash", type: "bytes32" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "settle",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "decision",
        type: "tuple",
        components: [
          { name: "jobId", type: "uint256" },
          { name: "briefHash", type: "bytes32" },
          { name: "deliveryHash", type: "bytes32" },
          { name: "evidenceHash", type: "bytes32" },
          { name: "verdict", type: "uint8" },
          { name: "validUntil", type: "uint64" },
        ],
      },
      { name: "signature", type: "bytes" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "resolveCaution",
    stateMutability: "nonpayable",
    inputs: [
      { name: "jobId", type: "uint256" },
      { name: "release", type: "bool" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "cancelExpired",
    stateMutability: "nonpayable",
    inputs: [{ name: "jobId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "setVerifierSigner",
    stateMutability: "nonpayable",
    inputs: [{ name: "newSigner", type: "address" }],
    outputs: [],
  },

  // --- reads ----------------------------------------------------------------
  {
    type: "function",
    name: "getJob",
    stateMutability: "view",
    inputs: [{ name: "jobId", type: "uint256" }],
    outputs: [
      {
        name: "job",
        type: "tuple",
        components: [
          { name: "buyer", type: "address" },
          { name: "createdAt", type: "uint64" },
          { name: "status", type: "uint8" },
          { name: "verdict", type: "uint8" },
          { name: "provider", type: "address" },
          { name: "deliverBy", type: "uint64" },
          { name: "amount", type: "uint128" },
          { name: "briefHash", type: "bytes32" },
          { name: "deliveryHash", type: "bytes32" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "jobCount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "verifierSigner",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "owner",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "domainSeparator",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "bytes32" }],
  },
  {
    type: "function",
    name: "MAX_DECISION_TTL",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint64" }],
  },

  // --- events ---------------------------------------------------------------
  {
    type: "event",
    name: "JobCreated",
    inputs: [
      { name: "jobId", type: "uint256", indexed: true },
      { name: "buyer", type: "address", indexed: true },
      { name: "provider", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
      { name: "briefHash", type: "bytes32", indexed: false },
      { name: "deliverBy", type: "uint64", indexed: false },
    ],
  },
  {
    type: "event",
    name: "DeliverySubmitted",
    inputs: [
      { name: "jobId", type: "uint256", indexed: true },
      { name: "deliveryHash", type: "bytes32", indexed: false },
    ],
  },
  {
    type: "event",
    name: "DecisionApplied",
    inputs: [
      { name: "jobId", type: "uint256", indexed: true },
      { name: "verdict", type: "uint8", indexed: false },
      { name: "evidenceHash", type: "bytes32", indexed: false },
      { name: "verifier", type: "address", indexed: true },
    ],
  },
  {
    type: "event",
    name: "PaymentReleased",
    inputs: [
      { name: "jobId", type: "uint256", indexed: true },
      { name: "provider", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "BuyerRefunded",
    inputs: [
      { name: "jobId", type: "uint256", indexed: true },
      { name: "buyer", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "CautionRaised",
    inputs: [
      { name: "jobId", type: "uint256", indexed: true },
      { name: "evidenceHash", type: "bytes32", indexed: false },
    ],
  },
  {
    type: "event",
    name: "JobCancelled",
    inputs: [
      { name: "jobId", type: "uint256", indexed: true },
      { name: "buyer", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "VerifierSignerUpdated",
    inputs: [
      { name: "previousSigner", type: "address", indexed: true },
      { name: "newSigner", type: "address", indexed: true },
    ],
  },

  // --- errors (so viem can decode reverts into something readable) ----------
  { type: "error", name: "ZeroAddress", inputs: [] },
  { type: "error", name: "ZeroAmount", inputs: [] },
  { type: "error", name: "AmountTooLarge", inputs: [] },
  { type: "error", name: "EmptyBriefHash", inputs: [] },
  { type: "error", name: "EmptyDeliveryHash", inputs: [] },
  { type: "error", name: "InvalidDeadline", inputs: [] },
  { type: "error", name: "UnknownJob", inputs: [] },
  { type: "error", name: "NotProvider", inputs: [] },
  { type: "error", name: "NotBuyer", inputs: [] },
  {
    type: "error",
    name: "InvalidStatus",
    inputs: [
      { name: "expected", type: "uint8" },
      { name: "actual", type: "uint8" },
    ],
  },
  { type: "error", name: "DeadlinePassed", inputs: [] },
  { type: "error", name: "DeadlineNotReached", inputs: [] },
  { type: "error", name: "DecisionExpired", inputs: [] },
  { type: "error", name: "DecisionTtlTooLong", inputs: [] },
  { type: "error", name: "BriefHashMismatch", inputs: [] },
  { type: "error", name: "DeliveryHashMismatch", inputs: [] },
  { type: "error", name: "InvalidVerdict", inputs: [] },
  { type: "error", name: "VerdictAlreadyApplied", inputs: [{ name: "applied", type: "uint8" }] },
  { type: "error", name: "NotCaution", inputs: [] },
  { type: "error", name: "InvalidSignature", inputs: [] },
  { type: "error", name: "TransferFailed", inputs: [] },
] as const;

/** Mirrors `AgentWorkEscrow.Status`. */
export const JOB_STATUS = ["None", "Funded", "Delivered", "Settled", "Cancelled"] as const;
export type JobStatusName = (typeof JOB_STATUS)[number];

/** Mirrors `AgentWorkEscrow.Verdict`. */
export const JOB_VERDICT = ["None", "GO", "CAUTION", "NO_GO"] as const;
export type JobVerdictName = (typeof JOB_VERDICT)[number];

export function statusName(status: number): JobStatusName {
  return JOB_STATUS[status] ?? "None";
}

export function verdictName(verdict: number): JobVerdictName {
  return JOB_VERDICT[verdict] ?? "None";
}
