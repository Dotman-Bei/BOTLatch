/**
 * Wallet configuration.
 *
 * Injected connector only. The MVP does not ship WalletConnect: it needs a project id, a relay
 * round-trip and a modal, none of which earn their place while the only supported chain is one the
 * user has to add to their wallet by hand anyway.
 *
 * `ssr: true` keeps wagmi from reading `localStorage` during the server render, which would
 * otherwise produce a hydration mismatch on every page that shows connection state.
 */

// `injected` comes from `wagmi` itself, not `wagmi/connectors`. The latter is a barrel that
// statically re-exports every connector, including `baseAccount` -> @base-org/account ->
// @coinbase/cdp-sdk, which imports `@x402/*` peers that are declared optional and therefore never
// installed. Webpack resolves every specifier in a barrel regardless of tree-shaking, so importing
// from it fails the production build on modules this app has no use for.
import { createConfig, http, injected } from "wagmi";
import { botChain } from "./chain";
import { PUBLIC_CONFIG } from "./config";

let cached: ReturnType<typeof build> | null = null;

function build() {
  return createConfig({
    chains: [botChain],
    connectors: [injected({ shimDisconnect: true })],
    transports: {
      [botChain.id]: http(PUBLIC_CONFIG.rpcUrl),
    },
    ssr: true,
  });
}

/**
 * One config per process. Re-creating it on a fast-refresh re-render drops the connection and
 * makes the connect button flicker back to "Connect wallet" mid-transaction.
 */
export function wagmiConfig() {
  cached ??= build();
  return cached;
}
