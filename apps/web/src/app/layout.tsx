import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { ConnectButton } from "@/components/connect-button";
import { Providers } from "@/components/providers";
import { PUBLIC_CONFIG } from "@/lib/config";
import "./globals.css";

export const metadata: Metadata = {
  title: "BOTLatch — AI-gated escrow for agent work",
  description:
    "Fund a job in escrow on BOT Chain. A verification agent reviews the delivery against the brief and signs a GO, CAUTION or NO_GO decision that drives settlement on-chain.",
  applicationName: "BOTLatch",
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: "#0a0a0a",
  colorScheme: "dark",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <div className="shell">
            <header className="header">
              <div className="container row-between" style={{ width: "100%" }}>
                <Link href="/" className="brand">
                  BOT<span>Latch</span>
                </Link>
                <nav className="nav" aria-label="Main">
                  <Link href="/create">Create job</Link>
                  <a
                    href={PUBLIC_CONFIG.explorerUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    BOTScan
                  </a>
                  <ConnectButton />
                </nav>
              </div>
            </header>

            <main className="main">{children}</main>

            <footer className="footer">
              <div className="container row-between">
                <span>Built on BOT Chain; not affiliated with BOT Chain.</span>
                <span className="mono">
                  chain {PUBLIC_CONFIG.chainId}
                  {PUBLIC_CONFIG.escrowAddress ? ` · escrow ${PUBLIC_CONFIG.escrowAddress.slice(0, 10)}…` : " · escrow not set"}
                </span>
              </div>
            </footer>
          </div>
        </Providers>
      </body>
    </html>
  );
}
