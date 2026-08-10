/**
 * Pre-deployment preflight.
 *
 *   npm run chain:verify
 *
 * Checks the things that are cheap to check now and expensive to discover later: that the RPC is
 * reachable, that it is really chain 677 and not a fork or a testnet, that the deployer has gas,
 * and — once an escrow address is set — that the contract exists and its `verifierSigner` matches
 * the key the app will sign with.
 *
 * That last check is the one worth running twice. If the addresses disagree, every signature the
 * verifier produces validates locally and every `settle` call reverts with `InvalidSignature`; the
 * symptom looks like a broken contract rather than a mismatched key.
 *
 * Reads .env from the repo root. Never prints a private key — only the address derived from it.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// viem comes from the hoisted workspace install, so this script needs `npm install` to have run.
let viem;
let accounts;
try {
  viem = await import("viem");
  accounts = await import("viem/accounts");
} catch {
  console.error("viem is not installed. Run `npm install` first.");
  process.exit(1);
}
const { createPublicClient, http, formatEther, isAddress, getAddress } = viem;
const { privateKeyToAccount } = accounts;

function loadEnv() {
  const env = { ...process.env };
  for (const file of [".env", ".env.local"]) {
    let text;
    try {
      text = readFileSync(resolve(ROOT, file), "utf8");
    } catch {
      continue;
    }
    for (const line of text.split(/\r?\n/)) {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
      if (!match) continue;
      const [, key, rawValue] = match;
      // Explicit shell environment wins over the file, matching how Next.js resolves these.
      if (process.env[key] !== undefined && process.env[key] !== "") continue;
      env[key] = rawValue.trim().replace(/^["']|["']$/g, "");
    }
  }
  return env;
}

const env = loadEnv();
const results = [];
let failed = false;

function record(ok, label, detail) {
  results.push({ ok, label, detail });
  if (ok === false) failed = true;
}

const rpcUrl = env.BOT_RPC_URL?.trim() || "https://rpc.botchain.ai";
const expectedChainId = Number(env.BOT_CHAIN_ID ?? 677);

const client = createPublicClient({ transport: http(rpcUrl) });

// --- chain identity ---------------------------------------------------------

let chainId = null;
try {
  chainId = await client.getChainId();
  record(
    chainId === expectedChainId,
    `Chain id is ${chainId}`,
    chainId === expectedChainId
      ? `matches BOT_CHAIN_ID=${expectedChainId}`
      : `EXPECTED ${expectedChainId}. Every EIP-712 signature is bound to the chain id — deploying against the wrong one produces an escrow that can never verify a decision.`,
  );
} catch (error) {
  record(false, `RPC ${rpcUrl} is unreachable`, error.message);
}

if (chainId !== null) {
  try {
    const block = await client.getBlockNumber();
    record(true, `Latest block ${block}`, "RPC is serving current state");
  } catch (error) {
    record(false, "Could not read the latest block", error.message);
  }
}

// --- deployer ---------------------------------------------------------------

const deployerKey = env.DEPLOYER_PRIVATE_KEY?.trim();
if (!deployerKey) {
  record(null, "DEPLOYER_PRIVATE_KEY is not set", "Required only when you deploy");
} else if (!/^0x[0-9a-fA-F]{64}$/.test(deployerKey)) {
  record(false, "DEPLOYER_PRIVATE_KEY is malformed", "Expected 0x followed by 64 hex characters");
} else {
  const deployer = privateKeyToAccount(deployerKey);
  try {
    const balance = await client.getBalance({ address: deployer.address });
    record(
      balance > 0n,
      `Deployer ${deployer.address}`,
      balance > 0n ? `${formatEther(balance)} BOT` : "NO BALANCE — deployment will fail",
    );
  } catch (error) {
    record(false, `Deployer ${deployer.address}`, `balance lookup failed: ${error.message}`);
  }
}

// --- verifier key -----------------------------------------------------------

const verifierKey = env.VERIFIER_PRIVATE_KEY?.trim();
let verifierAddress = null;
if (!verifierKey) {
  record(null, "VERIFIER_PRIVATE_KEY is not set", "The app cannot sign decisions without it");
} else if (!/^0x[0-9a-fA-F]{64}$/.test(verifierKey)) {
  record(false, "VERIFIER_PRIVATE_KEY is malformed", "Expected 0x followed by 64 hex characters");
} else {
  verifierAddress = privateKeyToAccount(verifierKey).address;
  record(true, `Verifier signer ${verifierAddress}`, "derived from VERIFIER_PRIVATE_KEY");

  if (deployerKey && /^0x[0-9a-fA-F]{64}$/.test(deployerKey)) {
    const same =
      privateKeyToAccount(deployerKey).address.toLowerCase() === verifierAddress.toLowerCase();
    record(
      !same,
      same ? "Deployer and verifier are the SAME key" : "Deployer and verifier are separate keys",
      same
        ? "Use separate keys. The verifier key sits on an internet-facing server; the deployer key owns the contract."
        : "good — a compromised verifier cannot take ownership of the escrow",
    );
  }
}

// --- deployed escrow --------------------------------------------------------

const escrow = env.BOT_ESCROW_ADDRESS?.trim();
if (!escrow) {
  record(null, "BOT_ESCROW_ADDRESS is not set", "Set it after deploying, then re-run this check");
} else if (!isAddress(escrow)) {
  record(false, "BOT_ESCROW_ADDRESS is not a valid address", escrow);
} else if (chainId !== null) {
  const address = getAddress(escrow);
  try {
    const code = await client.getCode({ address });
    if (!code || code === "0x") {
      record(false, `No contract at ${address}`, "Nothing is deployed there on this chain");
    } else {
      record(true, `Contract found at ${address}`, `${(code.length - 2) / 2} bytes`);

      const onChainSigner = await client.readContract({
        address,
        abi: [
          {
            type: "function",
            name: "verifierSigner",
            stateMutability: "view",
            inputs: [],
            outputs: [{ type: "address" }],
          },
        ],
        functionName: "verifierSigner",
      });

      if (!verifierAddress) {
        record(null, `Contract verifierSigner is ${onChainSigner}`, "No local key to compare against");
      } else {
        const match = onChainSigner.toLowerCase() === verifierAddress.toLowerCase();
        record(
          match,
          match ? "Verifier key matches the contract" : "VERIFIER MISMATCH",
          match
            ? `${onChainSigner}`
            : `contract expects ${onChainSigner}, app would sign as ${verifierAddress}. Every settle() will revert with InvalidSignature until these agree — fix VERIFIER_PRIVATE_KEY or call setVerifierSigner.`,
        );
      }
    }
  } catch (error) {
    record(false, `Could not inspect ${address}`, error.message);
  }
}

// --- public mirrors ---------------------------------------------------------

for (const [server, client_] of [
  ["BOT_CHAIN_ID", "NEXT_PUBLIC_BOT_CHAIN_ID"],
  ["BOT_ESCROW_ADDRESS", "NEXT_PUBLIC_BOT_ESCROW_ADDRESS"],
  ["BOT_RPC_URL", "NEXT_PUBLIC_BOT_RPC_URL"],
]) {
  const a = (env[server] ?? "").trim().toLowerCase();
  const b = (env[client_] ?? "").trim().toLowerCase();
  if (!a && !b) continue;
  record(
    a === b,
    `${server} / ${client_}`,
    a === b ? "in sync" : `MISMATCH: "${env[server] ?? ""}" vs "${env[client_] ?? ""}"`,
  );
}

// --- report -----------------------------------------------------------------

console.log(`\nBOTLatch preflight — ${rpcUrl}\n`);
for (const { ok, label, detail } of results) {
  const mark = ok === true ? "  ok " : ok === false ? "FAIL " : "  -- ";
  console.log(`${mark} ${label}`);
  if (detail) console.log(`      ${detail}`);
}

console.log(
  failed
    ? "\nOne or more checks failed. Fix them before deploying or accepting real funds.\n"
    : "\nAll hard checks passed.\n",
);

process.exit(failed ? 1 : 0);
