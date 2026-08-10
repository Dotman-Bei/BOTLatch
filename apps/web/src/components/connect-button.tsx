"use client";

import { useCallback, useEffect, useState } from "react";
import { useAccount, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { botChain } from "@/lib/chain";
import { PUBLIC_CONFIG } from "@/lib/config";
import { friendlyError, truncateAddress } from "@/lib/format";

/**
 * Connect / network / disconnect control.
 *
 * Three states in one button because they are one decision for the user: not connected, connected
 * to the wrong chain, connected and ready. The wrong-chain state is never silent — every write in
 * this app reverts or targets the wrong contract if the wallet is on another network.
 */
export function ConnectButton() {
  const { address, isConnected, chainId } = useAccount();
  const { connect, connectors, isPending, error: connectError } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain, isPending: isSwitching, error: switchError } = useSwitchChain();
  const [mounted, setMounted] = useState(false);

  // Wallet presence is unknowable on the server; render the neutral shell until hydration so the
  // markup matches and React does not blow away the tree.
  useEffect(() => setMounted(true), []);

  const injectedConnector = connectors.find((c) => c.id === "injected") ?? connectors[0];

  const onConnect = useCallback(() => {
    if (injectedConnector) connect({ connector: injectedConnector });
  }, [connect, injectedConnector]);

  if (!mounted) {
    return (
      <button type="button" className="btn btn-sm" disabled>
        Connect wallet
      </button>
    );
  }

  if (!isConnected) {
    const hasInjected = typeof window !== "undefined" && "ethereum" in window;
    return (
      <div className="row" style={{ gap: "var(--s2)" }}>
        <button type="button" className="btn btn-sm" onClick={onConnect} disabled={isPending}>
          {isPending ? "Connecting…" : "Connect wallet"}
        </button>
        {!hasInjected && (
          <span className="small muted">No browser wallet detected.</span>
        )}
        {connectError && <span className="small" style={{ color: "var(--stop)" }}>{friendlyError(connectError)}</span>}
      </div>
    );
  }

  if (chainId !== PUBLIC_CONFIG.chainId) {
    return (
      <div className="row" style={{ gap: "var(--s2)" }}>
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => switchChain({ chainId: botChain.id })}
          disabled={isSwitching}
        >
          {isSwitching ? "Switching…" : `Switch to ${botChain.name}`}
        </button>
        {switchError && (
          <span className="small" style={{ color: "var(--stop)" }}>{friendlyError(switchError)}</span>
        )}
      </div>
    );
  }

  return (
    <div className="row" style={{ gap: "var(--s2)" }}>
      <span className="badge badge-accent" title={address}>
        <span className="dot" aria-hidden="true" />
        {truncateAddress(address)}
      </span>
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => disconnect()}>
        Disconnect
      </button>
    </div>
  );
}
