"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Wallet presence is unknowable on the server; render the neutral shell until hydration so the
  // markup matches and React does not blow away the tree.
  useEffect(() => setMounted(true), []);

  // A menu that only closes via its own button strands the reader: they click elsewhere, nothing
  // happens, and the panel sits over the page.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const injectedConnector = connectors.find((c) => c.id === "injected") ?? connectors[0];

  const onConnect = useCallback(() => {
    if (injectedConnector) connect({ connector: injectedConnector });
  }, [connect, injectedConnector]);

  if (!mounted) {
    return (
      <button type="button" className="btn btn-sm btn-pill" disabled>
        Connect wallet
      </button>
    );
  }

  if (!isConnected) {
    const hasInjected = typeof window !== "undefined" && "ethereum" in window;
    return (
      <div className="row" style={{ gap: "var(--s2)" }}>
        <button
          type="button"
          className="btn btn-sm btn-pill"
          onClick={onConnect}
          disabled={isPending}
        >
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
          className="btn btn-sm btn-pill"
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

  // Connected: one control, not two. Disconnecting is rare and irreversible-feeling, so it sits
  // behind a deliberate click rather than permanently occupying space beside the address.
  return (
    <div className="wallet-menu" ref={menuRef}>
      <button
        type="button"
        className="btn btn-sm btn-pill"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="menu"
        title={address}
      >
        <span className="dot" aria-hidden="true" />
        {truncateAddress(address)}
      </button>

      {open && (
        <div className="wallet-pop" role="menu">
          <p className="wallet-pop-addr mono" title={address}>
            {address}
          </p>
          <button
            type="button"
            className="btn btn-ghost btn-sm btn-block"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              disconnect();
            }}
          >
            Disconnect
          </button>
        </div>
      )}
    </div>
  );
}
