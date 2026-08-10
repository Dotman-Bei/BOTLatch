/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The verifier is consumed as TypeScript source from the workspace, not as a build artefact.
  transpilePackages: ["@botlatch/verifier"],
  eslint: { ignoreDuringBuilds: true },
  // The verifier is `"type": "module"`, so its internal imports carry explicit `.js` specifiers —
  // which is what TypeScript requires and what its own `tsc` and Vitest both already resolve back
  // to `.ts`. Webpack does not do that substitution on its own, and the files it would be looking
  // for (`src/types.js`) are never emitted. Without this the build fails on the first
  // `export * from "./types.js"` in the package barrel.
  webpack(config) {
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".ts", ".tsx", ".js"],
      ".mjs": [".mts", ".mjs"],
      ".cjs": [".cts", ".cjs"],
    };
    return config;
  },
  async headers() {
    // Next compiles every module through eval() in development (webpack's eval-source-map), so a
    // policy without 'unsafe-eval' blocks the entire client bundle there. The failure is quiet and
    // easy to misread: the server-rendered HTML still paints, so the page looks correct while React
    // never hydrates and every control — connect wallet, forms, lookup — silently does nothing.
    // The dev server's hot-reload socket needs ws: for the same reason.
    //
    // Production is built without eval and keeps the strict policy; these relaxations must never
    // apply to it.
    const isDev = process.env.NODE_ENV === "development";

    const scriptSrc = isDev
      ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
      : "script-src 'self' 'unsafe-inline'";
    const connectSrc = isDev
      ? "connect-src 'self' https: ws: wss:"
      : "connect-src 'self' https:";

    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // No third-party scripts, no remote styles, no embedding. Wallet injection happens
          // in-page via window.ethereum, which needs no network allowance of its own.
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              scriptSrc,
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data:",
              connectSrc,
              "frame-ancestors 'none'",
              "base-uri 'self'",
              "form-action 'self'",
            ].join("; "),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
