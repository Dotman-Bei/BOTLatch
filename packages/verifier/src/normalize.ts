/**
 * Text normalization and layered decoding.
 *
 * An attacker hides instructions by encoding them (base64, hex, \u escapes) or by splitting
 * them with invisible characters. The deterministic scanner therefore never sees only the raw
 * string: it sees a set of *layers*, each a plausible reading of the same delivery.
 *
 * The invisible-character filter — the one an evasion attempt hits first — is built from ASCII
 * escapes rather than literal bytes, so an editor or transport that normalizes away zero-width
 * characters cannot weaken it invisibly. The homoglyph table below is literal for legibility;
 * it is a mapping rather than a gate, and a mangled entry degrades to no folding for that one
 * character rather than opening the filter.
 */

/**
 * The invisible-character class written out as a regex literal.
 *
 * Exported for `normalize.test.ts` only, and deliberately *not* what the scanner matches against:
 * this line contains real zero-width and bidi-control bytes, so an editor or transport that
 * normalized them away would weaken the filter with nothing visible in a diff. Matching runs on
 * `INVISIBLE_CHARS` below, compiled from ASCII escapes. The test asserts the two agree, so
 * mangling this line fails a test rather than quietly reducing coverage.
 */
export const INVISIBLE_CHARS_LITERAL =
  /[­᠎​-‏‪-‮⁠-⁤⁦-⁩﻿]/g;

/** Same class as ASCII escapes, for building a bounded intra-word probe. */
export const INVISIBLE_CHAR_CLASS =
  "\\u00AD\\u180E\\u200B-\\u200F\\u202A-\\u202E\\u2060-\\u2064\\u2066-\\u2069\\uFEFF";

/**
 * Zero-width, bidi-control, and other invisible characters used to break up keywords.
 *
 * Compiled from `INVISIBLE_CHAR_CLASS` rather than written as a literal, so the bytes this
 * scanner strips are defined once, in escapes, in a form no editor can silently rewrite. This
 * is the regex everything in this module actually uses.
 */
const INVISIBLE_CHARS = new RegExp(`[${INVISIBLE_CHAR_CLASS}]`, "g");

/** Characters that look like ASCII but are not — used to evade literal matching. */
const HOMOGLYPHS: Record<string, string> = {
  "а": "a", // cyrillic a
  "е": "e", // cyrillic ie
  "о": "o", // cyrillic o
  "р": "p", // cyrillic er
  "с": "c", // cyrillic es
  "х": "x", // cyrillic ha
  "ѕ": "s", // cyrillic dze
  "і": "i", // cyrillic byelorussian-ukrainian i
  "ο": "o", // greek omicron
  "α": "a", // greek alpha
  "А": "a", // cyrillic capital a
  "Е": "e", // cyrillic capital ie
  "О": "o", // cyrillic capital o
  "‐": "-",
  "‑": "-",
  "‒": "-",
  "–": "-",
  "—": "-",
  "‘": "'",
  "’": "'",
  "“": '"',
  "”": '"',
};

export interface NormalizedText {
  /** Original input, unchanged. */
  raw: string;
  /**
   * NFKC-folded, invisible characters stripped, homoglyphs mapped, whitespace collapsed,
   * lowercased. This is the primary scanning surface.
   */
  normalized: string;
  /**
   * Same as `normalized`, but with letter-spacing evasion undone: "i g n o r e" and
   * "i.g.n.o.r.e" collapse back to "ignore" while real word boundaries survive.
   */
  despaced: string;
  /** Count of invisible characters removed — itself a signal. */
  invisibleCharsRemoved: number;
  /** True when the raw text contained invisible characters *inside* a word. */
  hasIntraWordInvisibles: boolean;
}

export interface DecodedLayer {
  kind: "base64" | "hex" | "unicode-escape";
  /** Decoded plaintext, normalized the same way as the main body. */
  text: string;
  /** Length of the source token that produced it. */
  sourceLength: number;
}

/**
 * Undo character-level separator injection.
 *
 * Two forms are collapsed, both requiring a *run* of at least three single characters so that
 * ordinary prose is left alone:
 *
 *   "i g n o r e   a l l"  ->  "ignore all"   (single spaces inside a run; wider gaps survive
 *                                              as word boundaries)
 *   "i.g.n.o.r.e"          ->  "ignore"       (punctuation used as the separator)
 *
 * Collapsing only single spaces is what keeps word boundaries intact, which in turn is what
 * lets the grammar-anchored signatures in `patterns.ts` run against this surface at all.
 */
function collapseSeparators(text: string): string {
  return text
    .replace(/(?:[a-z0-9] ){2,}[a-z0-9](?![a-z0-9])/g, (run) => run.split(" ").join(""))
    .replace(/(?:[a-z0-9][._\-*|~+]){2,}[a-z0-9](?![a-z0-9])/g, (run) =>
      run.replace(/[._\-*|~+]/g, ""),
    );
}

/** Fold a string into the canonical scanning form. */
export function normalizeText(input: string): NormalizedText {
  const invisibleMatches = input.match(INVISIBLE_CHARS);
  const invisibleCharsRemoved = invisibleMatches ? invisibleMatches.length : 0;

  // An invisible character *between two word characters* is an evasion signature, whereas one
  // at a boundary is often innocuous copy-paste residue.
  const hasIntraWordInvisibles = new RegExp(
    `[A-Za-z0-9][${INVISIBLE_CHAR_CLASS}]+[A-Za-z0-9]`,
  ).test(input);

  let text = input.normalize("NFKC");
  text = text.replace(INVISIBLE_CHARS, "");
  text = text.replace(/[^\x00-\x7F]/g, (ch) => HOMOGLYPHS[ch] ?? ch);
  text = text.toLowerCase();

  const collapseWhitespace = (s: string) => s.replace(/\s+/g, " ").trim();

  return {
    raw: input,
    normalized: collapseWhitespace(text),
    despaced: collapseWhitespace(collapseSeparators(text)),
    invisibleCharsRemoved,
    hasIntraWordInvisibles,
  };
}

const BASE64_TOKEN = /[A-Za-z0-9+/]{24,}={0,2}/g;
const HEX_TOKEN = /(?:0x)?(?:[0-9a-fA-F]{2}){12,}/g;
const UNICODE_ESCAPE = /(?:\\u[0-9a-fA-F]{4}|\\x[0-9a-fA-F]{2}){4,}/g;

/** Fraction of printable ASCII required before we believe a decode produced real text. */
const PRINTABLE_RATIO = 0.85;

function looksLikeText(s: string): boolean {
  if (s.length < 8) return false;
  let printable = 0;
  for (const ch of s) {
    const code = ch.codePointAt(0) ?? 0;
    if (code === 9 || code === 10 || code === 13 || (code >= 32 && code <= 126)) printable++;
  }
  return printable / s.length >= PRINTABLE_RATIO;
}

function decodeBase64(token: string): string | null {
  try {
    let padded = token;
    if (padded.length % 4 !== 0) {
      padded = padded.padEnd(Math.ceil(padded.length / 4) * 4, "=");
    }
    const decoded = Buffer.from(padded, "base64").toString("utf8");
    return looksLikeText(decoded) ? decoded : null;
  } catch {
    return null;
  }
}

function decodeHex(token: string): string | null {
  try {
    const clean = token.startsWith("0x") ? token.slice(2) : token;
    if (clean.length % 2 !== 0) return null;
    const decoded = Buffer.from(clean, "hex").toString("utf8");
    return looksLikeText(decoded) ? decoded : null;
  } catch {
    return null;
  }
}

function decodeUnicodeEscapes(token: string): string | null {
  try {
    const decoded = token
      .replace(/\\u([0-9a-fA-F]{4})/g, (_m, h: string) => String.fromCharCode(parseInt(h, 16)))
      .replace(/\\x([0-9a-fA-F]{2})/g, (_m, h: string) => String.fromCharCode(parseInt(h, 16)));
    return looksLikeText(decoded) ? decoded : null;
  } catch {
    return null;
  }
}

/** Extract and decode every embedded-encoding layer we can recognise. */
export function decodeLayers(input: string, maxLayers = 24): DecodedLayer[] {
  const layers: DecodedLayer[] = [];
  const seen = new Set<string>();

  const push = (kind: DecodedLayer["kind"], decoded: string | null, sourceLength: number) => {
    if (!decoded || layers.length >= maxLayers) return;
    const text = normalizeText(decoded).normalized;
    if (!text || seen.has(`${kind}:${text}`)) return;
    seen.add(`${kind}:${text}`);
    layers.push({ kind, text, sourceLength });
  };

  for (const m of input.match(BASE64_TOKEN) ?? []) push("base64", decodeBase64(m), m.length);
  for (const m of input.match(HEX_TOKEN) ?? []) push("hex", decodeHex(m), m.length);
  for (const m of input.match(UNICODE_ESCAPE) ?? []) {
    push("unicode-escape", decodeUnicodeEscapes(m), m.length);
  }

  return layers;
}

export type SurfaceLayer =
  | "raw"
  | "normalized"
  | "base64"
  | "hex"
  | "unicode-escape"
  | "despaced";

export interface ScanSurface {
  layer: SurfaceLayer;
  text: string;
}

/**
 * Every textual reading the deterministic scanner should check.
 *
 * `despaced` undoes character-level separator injection ("i g n o r e  a l l", "i.g.n.o.r.e")
 * while preserving word boundaries and sentence punctuation, so the same grammar-anchored
 * signatures apply to it. It is still the most synthetic surface, so `patterns.ts` downgrades
 * its hits by one severity level.
 */
export function scanSurfaces(input: string): ScanSurface[] {
  const norm = normalizeText(input);
  const surfaces: ScanSurface[] = [
    { layer: "raw", text: input.toLowerCase() },
    { layer: "normalized", text: norm.normalized },
  ];

  for (const layer of decodeLayers(input)) {
    surfaces.push({ layer: layer.kind, text: layer.text });
  }

  // Only worth scanning when collapsing actually changed something.
  if (norm.despaced !== norm.normalized) {
    surfaces.push({ layer: "despaced", text: norm.despaced });
  }

  return surfaces;
}

/** Bounded, control-character-free excerpt for display and logging. */
export function redactExcerpt(text: string, index: number, span = 90): string {
  const start = Math.max(0, index - Math.floor(span / 3));
  const slice = text.slice(start, start + span);
  const clean = slice
    .replace(/[\x00-\x1F\x7F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const prefix = start > 0 ? "…" : "";
  const suffix = start + span < text.length ? "…" : "";
  return `${prefix}${clean}${suffix}`;
}
