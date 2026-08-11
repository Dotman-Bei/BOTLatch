/**
 * The BOTLatch mark.
 *
 * A keeper open on one side, closed by a bolt — a latch, which is what the escrow is: it holds
 * until something deliberately releases it. Silver for the structure, orange for the bolt, keeping
 * the interface's rule that orange marks the part that acts.
 *
 * Kept to two heavy shapes so it survives the favicon, where it is rendered at 16px. The same
 * geometry is duplicated in `app/icon.svg` rather than imported: Next reads that file at build time
 * to generate the icon and cannot pull it out of a component.
 *
 * Deliberately used in two places only — the footer and the browser tab. The header carries the
 * wordmark instead; a mark repeated in both would compete with itself on every page.
 */
export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      role="img"
      aria-label="BOTLatch"
      style={{ display: "block", flex: "none" }}
    >
      <rect width="32" height="32" rx="7" fill="#141414" stroke="#2a2a2a" />
      <path
        d="M22.5 8.5H11.5v15h11"
        fill="none"
        stroke="#c8c8c8"
        strokeWidth="3.5"
        strokeLinecap="square"
      />
      <rect x="18.5" y="13.25" width="9.5" height="5.5" rx="1.25" fill="#ff5400" />
    </svg>
  );
}
