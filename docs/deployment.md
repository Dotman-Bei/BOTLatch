# Deployment

Everything from "nothing deployed" to a working mainnet escrow. The deployment itself is
deliberately a manual, operator-run step: it needs your funded key, and that key should never live
on the application server.

This is the checklist promised in the README. Work through it top to bottom; the last item is
intentionally the first thing you do with real money.

## 0. Before you start

- Node 20+, Foundry installed (`forge --version`).
- An API key for an Anthropic-compatible chat completions endpoint.
- A browser wallet funded with enough BOT for the escrow deposit plus gas, pointed at chain id 677.
- Decide the owner address: a key you can hold offline, or a multisig. The deployer key and the
  owner should not be the same thing living in the same place.
- A machine you trust to hold the deployer key for the ten minutes the deployment takes.

## 1. Environment

```bash
npm install
npm run contracts:install
cp .env.example .env
```

Fill in `.env`:

| Variable | Value |
| --- | --- |
| `BOT_RPC_URL` | `https://rpc.botchain.ai` (verify with `cast chain-id --rpc-url "$BOT_RPC_URL"` → 677) |
| `DEPLOYER_PRIVATE_KEY` | 0x + 64 hex. Funded with BOT. **Never commit.** |
| `ESCROW_OWNER` | Leave empty to default to the deployer, or set your offline/multisig address |
| `VERIFIER_PRIVATE_KEY` | A *different* key — the one the server will hold |
| `LLM_API_KEY` | The model key |
| `INTERNAL_API_SECRET` | A long random string; change from the template |
| `DATABASE_URL` | Postgres connection string, or empty for the local JSON file |
| `APP_URL` | Wherever the app will be reachable from |

**The deployer key and the verifier key must be different.** The verifier key will sit on an
internet-facing server. If it were also the deployer key, a server compromise would mean the
attacker owns the contract.

## 2. Tests and preflight

```bash
npm test
npm run typecheck
npm run chain:verify
```

`chain:verify` is the gate: RPC reachable, chain id 677, deployer balance, key formats, deployer ≠
verifier, `NEXT_PUBLIC_*` mirrors agree. It exits non-zero on any hard failure and
`deploy.mjs` refuses to broadcast if it fails.

Nothing here sends a transaction.

## 3. Dry run

```bash
npm run contracts:deploy
```

This runs the preflight, derives `VERIFIER_SIGNER` from `VERIFIER_PRIVATE_KEY` (or reads an
explicit `VERIFIER_SIGNER` from `.env`), and prints the deployment it *would* broadcast. It does not
broadcast without `--yes`.

Read the printed contract address and constructor arguments. The escrow address should be new, and
the verifier signer shown should be the address you expect.

## 4. Broadcast

```bash
npm run contracts:deploy -- --yes
```

Wait for the transaction to confirm and note the contract address. Confirm on the explorer:
[scan.botchain.ai](https://scan.botchain.ai). Your new escrow should show the verifier signer and
owner you intended.

## 4a. Verify the source

Do this immediately after deploying, while the constructor arguments are still in front of you.
An unverified escrow asks people to trust a bytecode blob for a contract whose entire purpose is
being auditable.

BOTScan runs Blockscout on both networks, so `forge` can verify directly — no browser upload, no
flattening. The two networks differ only in the URL:

```bash
export PATH="$HOME/.foundry/bin:$PATH"
cd packages/contracts

# The constructor is (address verifierSigner_, address owner_) — same two values the deploy used.
ARGS=$(cast abi-encode "constructor(address,address)" "$VERIFIER_SIGNER" "$ESCROW_OWNER")

forge verify-contract "$BOT_ESCROW_ADDRESS" src/AgentWorkEscrow.sol:AgentWorkEscrow \
  --verifier blockscout \
  --verifier-url https://scan.botchain.ai/api \
  --constructor-args "$ARGS"
```

For the testnet rehearsal the only change is `--verifier-url https://scan.bohr.life/api`.

`forge` prints `Response: OK` and a GUID as soon as the submission is accepted — that is not the
same as being verified. Confirm the result:

```bash
curl -s "https://scan.botchain.ai/api/v2/smart-contracts/$BOT_ESCROW_ADDRESS" \
  | grep -o '"is_verified":[a-z]*'
```

Wrong constructor arguments are the usual failure, and they fail *after* the submission is
accepted — the bytecode comparison is what rejects them. If `is_verified` stays `false`, re-derive
`ARGS` from the values the deploy actually used rather than the ones you meant to use.

Verified on testnet at
[`0xcb152965…E6B4`](https://scan.bohr.life/address/0xcb152965e87f765eb8b5f91ceffa59510da1e6b4)
with solc v0.8.24 and optimizer on, using exactly the command above.

## 5. Point the app at it

```bash
# .env — server side
BOT_ESCROW_ADDRESS=0x…deployed…

# .env — browser side (public mirror; must match the server value exactly)
NEXT_PUBLIC_BOT_ESCROW_ADDRESS=0x…deployed…
```

Then run `npm run chain:verify` **again**. This second run is the important one: it reads
`verifierSigner()` from the *deployed* contract and compares it to the address derived from your
`VERIFIER_PRIVATE_KEY`. When these disagree, every signature validates locally and every `settle`
reverts with `InvalidSignature` — which looks exactly like a broken contract, and is in fact a
deployment that pointed the constructor at the wrong signer.

## 6. Run the server

```bash
npm run build
npm run start
```

Then, from a second terminal, the smoke checks:

```bash
curl -s http://localhost:3000/api/health
```

The two fields to read are `chainReachable: true` and `verifierMatchesContract: true`. The second is
the same check `chain:verify` runs, from inside the running server against the environment it
actually loaded — which is the version that counts. `false` or `null` there means the app cannot
settle anything, regardless of what your shell environment says.

The response is booleans and public addresses only; it never returns a key or a connection string.

Create a job through the UI (`/create`), confirm the on-chain state on the explorer, and verify the
brief appears on `/jobs/:id` with the correct hash.

## 7. Verifier round-trip (still with play money)

Until a real delivery exists, the verifier has nothing to sign — which is itself worth confirming
once: create a job, submit a delivery, and watch the job land on CAUTION or GO with the decision
applied on-chain. The outcome page should show the reasons and evidence.

If the verdict is CAUTION, test both `resolveCaution` paths: release and refund. Confirm the funds
move on-chain.

## 8. Operations

- **Releases.** The verifier signs GO when the delivery is safe and on-spec; the provider (or
  anyone) calls `settle`. CAUTION requires the buyer to call `resolveCaution`. NO_GO refunds.
- **Owner key.** Keep it offline. Its only routine job is `setVerifierSigner` if the verifier key is
  ever compromised.
- **Backups.** The store holds briefs, deliveries and evidence. If `DATABASE_URL` is empty you are
  using the JSON file in `.data/` — back it up. Losing it loses the human-readable record, not the
  funds.
- **The watcher.** Evaluation normally runs inline when the provider uploads their delivery. If that
  request dies between the on-chain `submitDelivery` and the upload completing, the job sits in
  `Delivered` with no verdict. `/api/cron/tick` sweeps `DeliverySubmitted` logs and evaluates
  whatever is pending — schedule it every few minutes:

  ```bash
  curl -X POST https://your-host/api/cron/tick \
    -H "authorization: Bearer $INTERNAL_API_SECRET"
  ```

  It also accepts GET, so scheduled-job runners that only issue GETs work without a shim. Both verbs
  require the secret. Where you have no scheduler,
  `npm run watch:chain --workspace @botlatch/web` polls the same endpoint from a long-running
  process; it reads `APP_URL` and `INTERNAL_API_SECRET` from `.env` and needs the server already
  running. Run either the scheduler or the watcher, not both against one database.
- **Monitoring.** Watch `/api/health`; alert on verifier-key absence or RPC failures. A model outage
  produces CAUTIONs (funds held), which is safe but will surface as support tickets.

## 9. First real job

Escrow an amount you are willing to lose entirely, with a provider you actually trust, and watch it
to completion. The system is designed so the worst realistic failure costs one job's amount, but
until the first completed job you are running on design intent, not observed behaviour.
