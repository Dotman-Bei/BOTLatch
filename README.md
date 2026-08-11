# BOTLatch

AI-gated escrow for agent work on BOT Chain.

A buyer escrows native BOT against a brief. A provider delivers work. A verification agent reads
the brief and the delivery, decides **GO**, **CAUTION**, or **NO_GO**, and signs that decision as
EIP-712 typed data. The escrow contract checks the signature and settles: GO pays the provider,
NO_GO refunds the buyer, CAUTION freezes the job until the buyer chooses.

The point is the failure mode. An agent that pays out on unverified work is a liability; an agent
that can be talked into paying out by the delivery itself is worse. Here the delivery never names
the payee, the amount, or a call target — those are fixed when the job is funded — and the
verification path is built so that a model outage, a timeout, or a malformed response resolves to
CAUTION. **No failure in verification can produce a GO.**

## Status

Pre-audit. The contract is tested and running on BOT Chain testnet with verified source; it has not
been through external review, and is not yet on mainnet. Treat the first mainnet deployment as a
test with an amount you are willing to lose.

## Deployments

| Network | Chain | Escrow | Explorer |
| --- | ---: | --- | --- |
| BOT testnet | 968 | `0xd4fa1258D1A60639E4C8BAe59e3110054Dd622cc` | [scan.bohr.life](https://scan.bohr.life/address/0xd4fa1258d1a60639e4c8bae59e3110054dd622cc) — source verified |
| BOT mainnet | 677 | not yet deployed | [scan.botchain.ai](https://scan.botchain.ai) |

An earlier testnet escrow at `0xcb152965…E6B4` is retired. It was deployed with Anvil's well-known
development keys as verifier and owner — fine for a local rehearsal, and unusable in public, since
anyone holding those keys could have signed a `GO` for any job on it. The current deployment uses a
verifier key generated for it alone, and an owner key that is not on any server.

All three settlement paths have been executed end to end on testnet, each driven by the verifier's
signed decision rather than by an operator moving funds:

| Verdict | Outcome | Transaction |
| --- | --- | --- |
| GO | provider paid 0.1 BOT | [`0x4d9afcf1…`](https://scan.bohr.life/tx/0x4d9afcf1d38bbbfa63367e9e81ddf6511dc525dec7194456a4058825ed18f1b1) |
| NO_GO | buyer refunded, provider paid nothing | [`0x1d3170b2…`](https://scan.bohr.life/tx/0x1d3170b2e412478c12c46f92b98f593c04533159bf10394f6c65028a6fba31ba) |
| CAUTION | funds held, then released by the buyer | [`0x6ca5e5b9…`](https://scan.bohr.life/tx/0x6ca5e5b9114cd1afa63ce52d2b14ac94b98b54edae545b4d2d617e4e8fcffc91) |

The NO_GO above came from the deterministic screener recognising a prompt-injection payload with no
model involved; the GO came from a model assessment scoring the delivery 92 on conformance and 95 on
safety. Reproduce either with `npm run e2e:local -- hostile` or `-- clean`.

## Requirements

- Node 20 or newer
- [Foundry](https://book.getfoundry.sh/getting-started/installation) (`forge`, `cast`)
- A browser wallet on BOT Chain — mainnet is chain id **677** at `https://rpc.botchain.ai`,
  testnet is chain id **968** at `https://rpc.bohr.life` ([faucet](https://faucet.botchain.ai/basic))
- An API key for an Anthropic-compatible chat completions endpoint

## Quickstart

```bash
npm install
npm run contracts:install     # forge-std + OpenZeppelin v5, vendored into packages/contracts/lib
cp .env.example .env          # then fill it in; see Environment below

npm test                      # vitest (verifier) + forge test (contract)
npm run chain:verify          # preflight: RPC, chain id, keys, deployed escrow
npm run dev                   # http://localhost:3000
```

Without `NEXT_PUBLIC_BOT_ESCROW_ADDRESS` the app runs but renders a setup notice in place of the
wallet actions, so you can review the UI before anything is deployed.

## Environment

`.env.example` is the full list with comments. The values that matter:

| Variable | Where it is read | Notes |
| --- | --- | --- |
| `BOT_RPC_URL`, `BOT_CHAIN_ID` | server, scripts | Chain id must be 677 |
| `BOT_ESCROW_ADDRESS` | server | Set after deploying |
| `NEXT_PUBLIC_BOT_*` | browser bundle | Public mirrors; `chain:verify` checks they agree |
| `DEPLOYER_PRIVATE_KEY` | `scripts/deploy.mjs` only | Never reaches the app |
| `ESCROW_OWNER` | deploy | Optional. Can rotate the verifier key, never move funds |
| `VERIFIER_PRIVATE_KEY` | server | Signs decisions. Holds no funds |
| `LLM_API_KEY`, `LLM_MODEL` | server | Model key, server-side only |
| `DATABASE_URL` | server | Empty falls back to a JSON file at `.data/` |
| `INTERNAL_API_SECRET` | server | Guards `/api/jobs/:id/evaluate` and `/api/cron/tick` |

Three rules the code enforces rather than trusts:

1. Anything the browser may read is prefixed `NEXT_PUBLIC_`. Server-only values live in
   [server-env.ts](apps/web/src/lib/server-env.ts), which imports `server-only` — importing it from
   a client component is a build error, not a runtime leak.
2. The deployer key and the verifier key must be different. `chain:verify` fails if they match: the
   verifier key sits on an internet-facing server, and it must not be able to own the contract.
3. The address derived from `VERIFIER_PRIVATE_KEY` must equal the contract's `verifierSigner()`.
   `chain:verify` reads both and compares them, because when they disagree every signature
   validates locally and every `settle` reverts with `InvalidSignature` — a mismatch that looks
   exactly like a broken contract.

## How a job moves

```
buyer                     provider                  verifier (server)         contract
  │                          │                            │                      │
  ├─ createJob ──────────────┼────────────────────────────┼─────────────────────▶│  Funded
  │  value = payment         │                            │                      │
  │  briefHash = keccak(brief)                            │                      │
  │                          │                            │                      │
  ├─ POST /api/jobs ─────────┼───────────────────────────▶│  stores brief        │
  │  (server re-hashes and compares to chain)             │                      │
  │                          │                            │                      │
  │                          ├─ submitDelivery ───────────┼─────────────────────▶│  Delivered
  │                          │  deliveryHash              │                      │
  │                          ├─ POST …/delivery ─────────▶│  stores text,        │
  │                          │  + personal_sign auth      │  evaluates           │
  │                          │                            │                      │
  │                          │                     GO / CAUTION / NO_GO          │
  │                          │                     signed EIP-712                │
  │                          │                            │                      │
  ├──────── settle(decision, signature) ──────────────────┴─────────────────────▶│
  │         (permissionless — the signature is the authority)                    │
  │                                                                              │
  │   GO      → provider paid, Settled                                           │
  │   NO_GO   → buyer refunded, Settled                                          │
  │   CAUTION → stays Delivered, funds locked                                    │
  │                                                                              │
  └─ resolveCaution(jobId, release) ────────────────────────────────────────────▶│  Settled
```

If the deadline passes with no delivery, the buyer calls `cancelExpired` and takes the funds back.

`settle` is deliberately permissionless. The signature names the job, both content hashes, the
evidence hash and the verdict, so whoever submits it, the outcome is identical — which means a
provider can collect a GO without waiting for the buyer to come back online.

## Repository layout

```
packages/contracts   AgentWorkEscrow.sol, Foundry tests, deploy script
packages/verifier     normalize → patterns → LLM → policy → EIP-712 signing
apps/web              Next.js 15 app: four screens + the API routes behind them
scripts               verify-chain.mjs (preflight), deploy.mjs (portable forge wrapper)
```

- [docs/architecture.md](docs/architecture.md) — what each layer does and why it is split this way
- [docs/threat-model.md](docs/threat-model.md) — what this defends against, and what it does not
- [docs/deployment.md](docs/deployment.md) — the mainnet checklist

## The verification path

Two layers, in order, in [packages/verifier](packages/verifier/src):

**Deterministic** ([patterns.ts](packages/verifier/src/patterns.ts)) — the delivery is normalised
(Unicode NFKC, zero-width and bidi controls stripped, homoglyphs folded) and then scanned for text
that tries to act on whoever reads it: instruction overrides, role reassignment, exfiltration
requests, tool-call injection, embedded credentials. `critical` or `high` forces NO_GO with no model
involvement at all. This layer cannot be argued with, which is exactly the point.

**Semantic** ([llm.ts](packages/verifier/src/llm.ts)) — the model is asked two questions: does this
answer the brief, and is it safe for an agent to consume? Both the brief and the delivery are
wrapped in delimited blocks and labelled untrusted. The response must parse as the expected JSON
shape; anything else counts as a failure, not a pass.

[policy.ts](packages/verifier/src/policy.ts) combines them. Ordering is load-bearing: blocking
checks run before the model's opinion, so a hostile delivery cannot be rescued by a model that
judged it benign. GO requires the deterministic layer to pass **and** the model layer to have
succeeded **and** returned safe and on-spec. Every other path holds or refunds.

The evidence behind a decision — scores, reasons, pattern ids, model name, a hash of the raw model
output — is hashed into `evidenceHash` and that hash is signed. The evidence itself is served from
the API so the outcome page can explain the verdict in plain English, and the contract only ever
sees 32 bytes.

## What goes on-chain

On-chain: job id, buyer, provider, amount, `briefHash`, `deliveryHash`, `evidenceHash`, verdict,
timestamps.

Never on-chain: the brief text, the delivered work, model prompts, model output, or anything
identifying a customer. Only hashes. The delivered work is not published by the app either — the
outcome page shows the brief and the reasoning, never the delivery.

## Testing

```bash
npm run test:contracts    # forge test -vv
npm run test:verifier     # vitest
npm run typecheck
```

The contract suite covers the settlement rules directly: expired decisions, TTL ceilings,
mismatched brief and delivery hashes, wrong signer, replay after settlement, re-delivery
invalidating a signed decision, CAUTION resolution by the buyer alone, and cancellation timing.

The verifier suite runs a fixture corpus of benign and adversarial deliveries through the whole
pipeline with a stubbed model, and asserts the fail-safe invariant explicitly: an LLM that throws,
times out, or returns nonsense yields CAUTION, never GO.

Both suites stub the seams they cross. `scripts/e2e-local.mjs` does not: it drives one job through
escrow, API, verifier, and escrow again against whatever chain `.env` points at, and asserts the
money moved the way the verdict said it should.

```bash
npm run e2e:local -- hostile   # prompt-injection payload -> NO_GO -> buyer refunded
npm run e2e:local -- clean     # genuine delivery -> GO -> provider paid
```

It refuses to run against mainnet. The hand-offs are where the hashes and signature formats have to
agree, and unit tests by construction cannot cover them — every bug found on testnet so far has
lived in a seam rather than in a layer.

## Deploying

```bash
npm run chain:verify              # confirm chain id, balances, key separation
npm run contracts:deploy          # dry run — prints what it would do
npm run contracts:deploy -- --yes # broadcasts
```

`deploy.mjs` runs the preflight itself and refuses to broadcast if it fails, derives
`VERIFIER_SIGNER` from `VERIFIER_PRIVATE_KEY` so the constructor cannot be given a stale address,
and passes keys through the environment rather than argv so they stay out of shell history and
process listings.

After deploying, set `BOT_ESCROW_ADDRESS` and `NEXT_PUBLIC_BOT_ESCROW_ADDRESS`, then run
`npm run chain:verify` again — that second run is what confirms the deployed contract trusts the
key your server actually holds.

Then publish the source. BOTScan runs Blockscout on both networks, so `forge` verifies directly —
no browser upload, no flattening:

```bash
forge verify-contract "$BOT_ESCROW_ADDRESS" src/AgentWorkEscrow.sol:AgentWorkEscrow \
  --verifier blockscout --verifier-url https://scan.botchain.ai/api \
  --constructor-args "$(cast abi-encode 'constructor(address,address)' "$VERIFIER_SIGNER" "$ESCROW_OWNER")"
```

`forge` prints `Response: OK` when the submission is *accepted*, which is not the same as verified —
the bytecode comparison happens afterwards, and wrong constructor arguments fail there. Read the
result back rather than trusting the OK. Full checklist in [docs/deployment.md](docs/deployment.md).

## Licence

MIT. Built on BOT Chain; not affiliated with BOT Chain.
