"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ConnectButton } from "@/components/connect-button";
import { PUBLIC_CONFIG } from "@/lib/config";

/**
 * Header.
 *
 * Two navigations, chosen by route. The landing page is being read, not used: it offers its own
 * sections and one way in. Every other route is the app itself, where a wallet is required to do
 * anything, so the controls that only matter once you are working live there instead of following
 * the reader around.
 *
 * The network badge appears on both. It is the one fact a person needs before signing anything, and
 * it is fixed per deployment rather than switchable — see PUBLIC_CONFIG.isMainnet.
 */
export function SiteHeader() {
  const pathname = usePathname();
  const isLanding = pathname === "/";
  const { faucetUrl, explorerUrl, isMainnet, networkLabel, chainId } = PUBLIC_CONFIG;

  return (
    <header className="header">
      <div className="container row-between" style={{ width: "100%" }}>
        <Link href="/" className="brand">
          BOT<span>Latch</span>
        </Link>

        {isLanding ? (
          <nav className="nav" aria-label="Main">
            <a href="#orchestration">Orchestration</a>
            <a href="#proof">On-chain proof</a>
            <NetworkBadge isMainnet={isMainnet} label={networkLabel} chainId={chainId} />
            <Link href="/create" className="btn btn-sm btn-pill">
              Create job
            </Link>
          </nav>
        ) : (
          <nav className="nav" aria-label="Main">
            <Link href="/create">Create job</Link>
            <a href={explorerUrl} target="_blank" rel="noopener noreferrer">
              BOTScan
            </a>
            {faucetUrl && (
              <a href={faucetUrl} target="_blank" rel="noopener noreferrer">
                Faucet
              </a>
            )}
            <NetworkBadge isMainnet={isMainnet} label={networkLabel} chainId={chainId} />
            <ConnectButton />
          </nav>
        )}
      </div>
    </header>
  );
}

/**
 * Which chain this deployment talks to.
 *
 * Deliberately loud on testnet and quiet on mainnet: someone who thinks they are on testnet and is
 * not stands to lose real money, while the reverse costs nothing.
 */
function NetworkBadge({
  isMainnet,
  label,
  chainId,
}: {
  isMainnet: boolean;
  label: string;
  chainId: number;
}) {
  return (
    <span
      className={isMainnet ? "net-badge net-badge-main" : "net-badge"}
      title={`This deployment is configured for chain ${chainId}. Switching networks requires a redeploy.`}
    >
      {label} · {chainId}
    </span>
  );
}
