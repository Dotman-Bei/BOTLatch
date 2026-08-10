"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Copy-to-clipboard button.
 *
 * `navigator.clipboard` is unavailable on insecure origins and inside some in-app wallet browsers,
 * so a `document.execCommand` path is kept as a fallback: a hash you cannot copy is a hash you
 * cannot verify, which defeats the point of showing it.
 */
export function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const copy = useCallback(async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
      } else {
        const area = document.createElement("textarea");
        area.value = value;
        area.setAttribute("readonly", "");
        area.style.position = "fixed";
        area.style.opacity = "0";
        document.body.appendChild(area);
        area.select();
        document.execCommand("copy");
        document.body.removeChild(area);
      }
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }, [value]);

  return (
    <button
      type="button"
      className="copy-btn"
      onClick={copy}
      aria-label={copied ? "Copied" : `${label} ${value}`}
    >
      {copied ? "Copied" : label}
    </button>
  );
}
