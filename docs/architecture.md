# Architecture

Three packages, one job: turn "did the agent actually do the work?" into a question a contract can
answer with a signature check.

```
packages/contracts   AgentWorkEscrow.sol — custody, state machine, EIP-712 verification
packages/verifier    normalize → patterns → LLM → policy → sign
apps/web             Next.js 15 — four screens, the API routes behind them, storage, chain reads
```

The split is not cosmetic. The contract holds the funds and knows nothing about AI. The verifier
makes judgements and holds nothing. The web app has neither custody nor final say — it stores text,
calls the verifier, and shows results. Compromising any one of them does not, on its own, move money
to an attacker.

---

## The contract

[packages/contracts/src/AgentWorkEscrow.sol](../packages/contracts/src/AgentWorkEscrow.sol)

### State machine

```
                createJob(provider, briefHash, deliverBy) + value
   None ─────────────────────────────────────────────────────────▶ Funded
                                                                     │
                              submitDelivery(jobId, deliveryHash)    │
                        ┌────────────────────────────────────────────┤
                        │                                            │
                        ▼                          cancelExpired     │
                    Delivered ◀─┐                  (buyer, after     ▼
                        │       │  re-deliver       deliverBy)   Cancelled
                        │       │  (no verdict yet)
       settle(decision, signature)
                        │
        ┌───────────────┼────────────────┐
        │               │                │
      GO │          CAUTION │        NO_GO │
        ▼               │                ▼
     Settled            │             Settled
   (provider paid)      │          (buyer refunded)
                        │
                   still Delivered, verdict = Caution, funds locked
                        │
              resolveCaution(jobId, release)   ← buyer only
                        ▼
                     Settled
```

`Status` is `{None, Funded, Delivered, Settled, Cancelled}` (0–4) and `Verdict` is
`{None, Go, Caution, NoGo}` (0–3). Both codes appear verbatim in the API responses and the UI, so
the numbers are part of the contract with the frontend, not an internal detail.

The one shape worth stating plainly, because it is easy to get wrong when reading the code: **a
CAUTION verdict leaves the job in `Delivered`.** It sets `verdict = Caution`, emits `CautionRaised`,
and returns without touching the balance. Only `resolveCaution` moves it to `Settled`. The UI keys
the Release/Refund buttons off `statusCode === 2 && verdictCode === 2` for exactly this reason.

### Why settle is permissionless

`settle` checks the signature, not the caller. Any address may submit a decision, and the result is
identical regardless of who does: the payee, the amount and both content hashes are fixed at job
creation and re-checked inside the call. This means a provider who earned a GO can collect it
without the buyer's cooperation, and a buyer owed a refund does not depend on the provider. It also
means a relayer can settle on behalf of a user with no wallet balance.

What stops a stranger settling maliciously is that there is no malicious version to submit. The
verifier signs one verdict per delivery; a decision for a different verdict does not exist.

### The four guards on a decision

```solidity
if (decision.briefHash != job.briefHash) revert BriefHashMismatch();
if (decision.deliveryHash != job.deliveryHash) revert DeliveryHashMismatch();
if (block.timestamp > decision.validUntil) revert DecisionExpired();
if (decision.validUntil > block.timestamp + MAX_DECISION_TTL) revert DecisionTtlTooLong();
```

Together with `job.verdict != Verdict.None` rejecting a second decision, these give:

- **No cross-job replay** — `jobId` is inside the signed struct, and the domain separator binds the
  signature to this contract on this chain id.
- **No cross-delivery replay** — if the provider re-delivers, `deliveryHash` changes and every
  previously signed decision becomes unusable. That is intentional: it is what makes re-delivery
  safe to allow.
- **No indefinite shelf life** — `MAX_DECISION_TTL` is one hour. A leaked signature cannot be held
  and used days later. The verifier issues much shorter windows; the ceiling is the contract's own
  backstop, not a trust assumption about the server.

The one-hour ceiling has a direct consequence in the UI: the settle button always requests a fresh
signature from `POST /api/jobs/:id/decision` immediately before submitting, because a page left open
would otherwise send an expired decision and revert.

### What the owner can and cannot do

`Ownable2Step`. The owner may call `setVerifierSigner` — that is the key-rotation path for a
compromised verifier. The owner cannot move escrowed funds, redirect a payout, change an amount, or
force a verdict. There is no withdraw function, no pause that strands money, and no upgrade proxy.
Every payout target is written at `createJob` and never read from anything the provider supplies.

---

## The verifier

[packages/verifier/src](../packages/verifier/src) — a plain TypeScript package with no server
dependencies, so it can be tested in isolation and reused outside the web app.

```
brief + delivery
      │
      ▼
 normalize.ts      NFKC, strip zero-width and bidi controls, fold homoglyphs
      │
      ▼
 patterns.ts       deterministic scan → PatternHit[] {id, label, severity}
      │
      ├──────────── critical | high ──────────────────────┐
      │                                                   │
      ▼                                                   │
 llm.ts            two questions: on-spec? safe to consume?│
      │            structured JSON, must parse             │
      ▼                                                   │
 policy.ts         decision table ◀────────────────────────┘
      │
      ▼
 sign.ts           evidenceHash = keccak(canonical evidence)
                   EIP-712 Decision, signed by VERIFIER_PRIVATE_KEY
```

### Normalisation before matching

An attacker's first move against a pattern scanner is to break up the string: zero-width joiners
inside a keyword, Cyrillic characters that render as Latin ones, right-to-left overrides that make
displayed text differ from stored text. [normalize.ts](../packages/verifier/src/normalize.ts) folds
all of that before anything is matched, so the scanner sees the text as a reader would.

Normalisation is for **matching only**. The bytes that get hashed and committed on-chain are always
the raw delivery, never the normalised form — otherwise the hash the buyer paid against and the hash
the verifier reasoned about would be different strings.

### The deterministic layer runs first, and can veto

[patterns.ts](../packages/verifier/src/patterns.ts) looks for a delivery that tries to *act on* its
reader rather than inform them: instruction overrides ("ignore previous instructions"), role
reassignment, tool or function-call injection, exfiltration requests, embedded credentials, hidden
directives in code fences or comments.

A `critical` or `high` hit returns NO_GO immediately, without calling the model. This ordering is
the defence against a prompt-injection payload persuading the reviewing model that it is harmless —
the model never gets asked.

### The model layer cannot be trusted to fail loudly

[llm.ts](../packages/verifier/src/llm.ts) presents brief and delivery inside delimited, explicitly
untrusted blocks and asks for a fixed JSON shape. Anything that is not a parseable response of that
shape — a timeout, a 500, a refusal, a truncated body, prose instead of JSON — becomes
`{ ok: false, failureReason }`, and `ok: false` cannot produce GO.

The raw model output is hashed into the evidence but never stored on-chain and never shown to the
public.

### The policy table

[policy.ts](../packages/verifier/src/policy.ts), in order:

| # | Condition | Verdict |
| --- | --- | --- |
| 1 | Deterministic `critical` or `high` hit | **NO_GO** |
| 2 | Delivery shorter than 40 characters | **NO_GO** |
| 3 | LLM layer unavailable (`ok: false`) | **CAUTION** |
| 4 | Model says hostile | **NO_GO** |
| 5 | Model says conformance fail | **NO_GO** |
| 6 | Suspicious, partial, or a `medium` pattern hit | **CAUTION** |
| 7 | Everything above passed | **GO** |

Row 3 is the invariant. There is no path from a broken model, a missing API key, a network failure,
or a malformed response to a payout. The tests assert this directly rather than relying on the table
being read correctly.

Scores (`conformanceScore`, `safetyScore`) are derived for the UI's benefit. They are advisory
context on the outcome page; the verdict itself is decided categorically, so no rounding or
threshold drift can change an outcome.

### Evidence and signing

[sign.ts](../packages/verifier/src/sign.ts) serialises the evidence canonically — sorted keys, fixed
number formatting — hashes it, and signs the `Decision` struct with `viem`'s typed-data signer
against domain `{name: "BOTLatch", version: "1", chainId, verifyingContract}`. The same four fields
appear in the contract's `EIP712("BOTLatch", "1")` constructor and its `DECISION_TYPEHASH`; if any
of them drifts, signatures verify locally and revert on-chain, which is why `chain:verify` compares
the signer address against the deployed contract before you trust a deployment.

Canonical serialisation matters because the decision route re-signs from stored evidence. It
recomputes `evidenceHash` from the stored evidence and refuses to sign if it disagrees with the
stored hash — a stored record that has been edited cannot be laundered into a fresh signature.

---

## The web app

[apps/web/src](../apps/web/src) — Next.js 15 App Router, React 19, wagmi v2 + viem v2.

### Server / client boundary

[server-env.ts](../apps/web/src/lib/server-env.ts) imports `server-only`, so any client component
that reaches for the verifier key, the model key or the database URL fails at build time rather than
shipping them to a browser. [config.ts](../apps/web/src/lib/config.ts) holds the mirror image: only
`NEXT_PUBLIC_*` values, safe to inline into the bundle.

Two consequences visible in the code:

- Client components import server modules **type-only** (`import type { PublicJob }`), so the
  runtime import is erased and `server-only` is never pulled into the bundle.
- `MAX_DELIVERY_CHARS` and `MIN_DELIVERY_CHARS` are re-declared in `config.ts` rather than imported
  from `@botlatch/verifier`, because that package re-exports the LLM client and importing two
  numbers would drag it into the browser. The delivery route asserts at module load that the two
  copies agree, so the duplication fails loudly instead of drifting.

### Storage

[store/](../apps/web/src/lib/store) is an interface with two implementations chosen by whether
`DATABASE_URL` is set: a JSON file at `.data/botlatch.json` for local work, Postgres otherwise. Rows
are keyed by `(chainId, contractAddress, jobId)` — a triple, not a bare job id — so pointing a
running app at a redeployed contract cannot surface the previous deployment's briefs against the new
one's job numbers.

The store holds the brief, the delivery, the evaluation and the evidence. It is a cache of things
whose hashes are already committed on-chain, which is what makes it safe to treat as untrusted: the
brief route re-hashes the posted text and compares it to the chain before accepting it, and the
evaluation path calls `assertHashesMatch` before sending anything to a model.

### API routes

| Route | Auth | Purpose |
| --- | --- | --- |
| `POST /api/jobs` | brief must hash to the on-chain `briefHash` | Store the brief after `createJob` confirms |
| `GET /api/jobs/:id` | public | Public view: chain state + evaluation, never the delivery text |
| `POST /api/jobs/:id/delivery` | `personal_sign` recovering to the on-chain provider | Store the delivery, queue evaluation |
| `POST /api/jobs/:id/evaluate` | `INTERNAL_API_SECRET` | Re-run evaluation (operator / watcher) |
| `POST /api/jobs/:id/decision` | public, rate-limited | Mint a fresh signature over the stored verdict |
| `POST /api/cron/tick` | `INTERNAL_API_SECRET` | Catch deliveries whose upload succeeded but evaluation did not (GET accepted too, for cron runners) |
| `POST /api/webhooks/chain` | `INTERNAL_API_SECRET` | Optional push path for the same work |
| `GET /api/health` | public | Config and RPC reachability, no secrets |

Three of these deserve a note.

**`POST /api/jobs`** has no session and needs none. The job must exist on-chain and the posted brief
must hash to the `briefHash` already committed there. Anyone may therefore submit the brief for a
job; nobody can submit a *different* brief than the one the buyer funded. First writer wins, so a
late caller cannot reset the title or the recorded transaction hash.

**`POST /api/jobs/:id/delivery`** requires three things at once: the escrow says `Delivered` with no
verdict, `keccak256(delivery)` equals the on-chain `deliveryHash`, and a `personal_sign` signature
over a message naming the chain id, contract, job id and delivery hash recovers to the on-chain
provider address. The hash check is what makes the content trustworthy; the signature is what stops
strangers writing into the store.

**`POST /api/jobs/:id/decision`** does not re-decide anything. The verdict was decided once when the
delivery was evaluated; this route re-signs that stored decision because `MAX_DECISION_TTL` is one
hour. Every signed field comes from storage and is re-checked against the chain first — only
`validUntil` differs between two calls. If the provider re-delivered in the meantime the hashes no
longer agree and the route refuses rather than signing a verdict about text nobody is offering.

### Screens

| Route | Component | What it does |
| --- | --- | --- |
| `/` | [page.tsx](../apps/web/src/app/page.tsx) | What the system does and what the agent actually checks |
| `/create` | [create-job-form.tsx](../apps/web/src/components/create-job-form.tsx) | Fund a job |
| `/jobs/:id/deliver` | [deliver-form.tsx](../apps/web/src/components/deliver-form.tsx) | Submit work (provider only, `noindex`) |
| `/jobs/:id` | [job-outcome.tsx](../apps/web/src/components/job-outcome.tsx) | Verdict, reasoning, settlement actions |

Two implementation details that are load-bearing rather than incidental:

The create flow reads the new job id from the `JobCreated` event in the transaction receipt via
`decodeEventLog`, **not** from `jobCount`. Two jobs created in the same block would race, and the
second reader would take the first's id.

The outcome page polls on a state-dependent interval: four seconds while a job is `Delivered` with
no verdict, twenty otherwise. Verification takes seconds, so the only moment that warrants fast
polling is the one where the user is watching for a verdict to land.

### Reads

[chain-server.ts](../apps/web/src/lib/chain-server.ts) reads the escrow server-side through a viem
public client and [public-view.ts](../apps/web/src/lib/public-view.ts) shapes it for the browser —
that shaping is where the delivery text gets dropped. The public job view carries the brief, both
hashes, the verdict and the evidence; it never carries the delivered work, on any route, to anyone.

`GET /api/jobs/:id` marks an evaluation `current: false` when its `deliveryHash` no longer matches
the chain, and the outcome page renders that as a stale-verdict warning rather than silently showing
a verdict about superseded work.
