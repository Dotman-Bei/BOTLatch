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
  const { faucetUrl, explorerUrl, escrowAddress, isMainnet, networkLabel, chainId } = PUBLIC_CONFIG;

  // The explorer's front page says nothing about this deployment. The contract's page is the
  // independent record of it: verified source, and every job ever settled here. Fall back to the
  // front page only when there is no contract to point at.
  const explorerHref = escrowAddress ? `${explorerUrl}/address/${escrowAddress}` : explorerUrl;

  // Three-column grid on the landing page rather than the app's two-part row: the section links
  // belong optically centred in the bar, and centring them inside a right-aligned group would put
  // them wherever the brand and the button happened to leave space.
  if (isLanding) {
    return (
      <header className="header">
        <div className="container header-landing">
          <Link href="/" className="brand">
            BOT<span>Latch</span>
          </Link>

          <nav className="nav-center" aria-label="Main">
            <a href="#orchestration">Orchestration</a>
            <a href="#proof">On-chain proof</a>
          </nav>

          <div className="nav-end">
            <Link href="/create" className="btn btn-sm btn-pill">
              Create job
            </Link>
          </div>
        </div>
      </header>
    );
  }

  return (
    <header className="header">
      <div className="container row-between" style={{ width: "100%" }}>
        <Link href="/" className="brand">
          BOT<span>Latch</span>
        </Link>

        <nav className="nav" aria-label="Main">
          <Link href="/jobs">Jobs</Link>
          <Link href="/create">Create job</Link>
          <a
            href={explorerHref}
            target="_blank"
            rel="noopener noreferrer"
            title="The escrow contract on BOTScan: verified source, and every job ever settled here"
          >
            Contract
          </a>
          {faucetUrl && (
            <a href={faucetUrl} target="_blank" rel="noopener noreferrer">
              Faucet
            </a>
          )}
          <NetworkBadge isMainnet={isMainnet} label={networkLabel} chainId={chainId} />
          <ConnectButton />
        </nav>
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
