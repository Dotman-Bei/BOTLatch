/**
 * Portable deploy wrapper.
 *
 *   npm run contracts:deploy
 *
 * `forge script` needs the RPC URL and the deployer key as arguments, and the shell syntax for
 * interpolating them differs between cmd.exe and sh — so the interpolation happens here instead,
 * in Node, where it behaves the same everywhere.
 *
 * The preflight in verify-chain.mjs runs first. Deploying to the wrong chain id produces an escrow
 * whose domain separator can never validate a decision, and the only fix is to deploy again.
 */

import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

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
      if (process.env[key] !== undefined && process.env[key] !== "") continue;
      env[key] = rawValue.trim().replace(/^["']|["']$/g, "");
    }
  }
  return env;
}

const env = loadEnv();

const rpcUrl = env.BOT_RPC_URL?.trim();
const deployerKey = env.DEPLOYER_PRIVATE_KEY?.trim();
const verifierKey = env.VERIFIER_PRIVATE_KEY?.trim();

const missing = [];
if (!rpcUrl) missing.push("BOT_RPC_URL");
if (!deployerKey) missing.push("DEPLOYER_PRIVATE_KEY");
if (!verifierKey && !env.VERIFIER_SIGNER) missing.push("VERIFIER_PRIVATE_KEY (or VERIFIER_SIGNER)");
if (missing.length > 0) {
  console.error(`Missing required values in .env: ${missing.join(", ")}`);
  process.exit(1);
}

// The contract constructor takes the verifier's *address*. Deriving it here means one fewer value
// to keep in sync by hand, and one fewer chance to deploy an escrow that trusts the wrong signer.
let verifierSigner = env.VERIFIER_SIGNER?.trim();
if (!verifierSigner) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(verifierKey)) {
    console.error("VERIFIER_PRIVATE_KEY is malformed: expected 0x followed by 64 hex characters.");
    process.exit(1);
  }
  const { privateKeyToAccount } = await import("viem/accounts");
  verifierSigner = privateKeyToAccount(verifierKey).address;
  console.log(`VERIFIER_SIGNER derived from VERIFIER_PRIVATE_KEY: ${verifierSigner}`);
}

// Preflight. `--` swallows the exit code deliberately only for the informational checks; a hard
// failure here means the deploy would be wrong, so stop.
const preflight = spawnSync(process.execPath, [resolve(ROOT, "scripts/verify-chain.mjs")], {
  stdio: "inherit",
  env,
});
if (preflight.status !== 0) {
  console.error("Preflight failed. Nothing was deployed.");
  process.exit(preflight.status ?? 1);
}

if (!process.argv.includes("--yes")) {
  console.log(
    "\nThis will broadcast a real transaction and spend real BOT.\n" +
      "Re-run with --yes to proceed:  npm run contracts:deploy -- --yes\n",
  );
  process.exit(0);
}

// forge runs *inside* the contracts directory rather than being pointed at it with `--root`.
// forge 1.7.1 rejects a relative `--root` outright ("The system cannot find the path specified"),
// and an absolute one is not an option here: on Windows this spawn goes through cmd.exe, and Node
// joins argv into a single command string *without* quoting it, so a checkout under a path with a
// space ("…/VIBE CODE/…") would arrive at forge split into two arguments.
//
// `cwd` has neither problem. Node passes it to the OS as its own parameter, never through the
// command string, so spaces in it are safe — and with no `--root` there is no path left in argv.
const contractsDir = resolve(ROOT, "packages", "contracts");

const args = ["script", "script/Deploy.s.sol:Deploy", "--rpc-url", rpcUrl, "--broadcast"];

console.log(`\nforge ${args.slice(0, 2).join(" ")} --rpc-url <redacted> --broadcast\n`);

// The key is passed through the environment, never on the command line, so it stays out of shell
// history and out of any process listing. The names here must match what Deploy.s.sol reads:
// vm.envUint("DEPLOYER_PRIVATE_KEY") and vm.envAddress("VERIFIER_SIGNER").
const child = spawn("forge", args, {
  cwd: contractsDir,
  stdio: "inherit",
  env: { ...env, DEPLOYER_PRIVATE_KEY: deployerKey, VERIFIER_SIGNER: verifierSigner },
  shell: process.platform === "win32",
});

child.on("exit", (code) => {
  if (code === 0) {
    console.log(
      "\nDeployed. Now set BOT_ESCROW_ADDRESS and NEXT_PUBLIC_BOT_ESCROW_ADDRESS in .env,\n" +
        "then run `npm run chain:verify` to confirm the verifier key matches the contract.\n",
    );
  }
  process.exit(code ?? 1);
});
