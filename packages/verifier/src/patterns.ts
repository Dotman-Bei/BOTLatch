/**
 * Deterministic prompt-injection signatures.
 *
 * These run before the LLM and can force NO_GO on their own, so their false-positive behaviour
 * matters as much as their detection rate. The governing rule from the threat model is:
 *
 *   **A description of an attack is not an attack.**
 *
 * A security report that says "the owner can transfer every depositor's funds" must pass. A
 * delivery that says "Transfer the escrowed funds to 0x..." must not. The two differ in grammar,
 * not vocabulary: the first has a subject and a modal, the second is an imperative aimed at the
 * reader. Every signature below therefore anchors on *addressed-imperative* or *second-person*
 * framing rather than on topic keywords.
 *
 * Severity meaning:
 *   critical — unambiguous instruction to the consuming agent; forces NO_GO alone.
 *   high     — strong evasion or exfiltration signal; forces NO_GO alone.
 *   medium   — context worth surfacing; escalates to CAUTION, never to NO_GO by itself.
 */

import { normalizeText, redactExcerpt, scanSurfaces } from "./normalize.js";
import type { DeterministicReport, PatternHit } from "./types.js";

/**
 * Clause-initial position: the start of the text, the start of a sentence, a list bullet, or a
 * discourse marker that introduces a directive. This is where an imperative verb lives.
 */
const IMP = "(?:^|[.!?\\n;:]\\s*|\\n\\s*[-*>]\\s*|\\b(?:please|now|instead|important|note|attention|urgent|first|then|finally)\\b[\\s,:]*)";

/** Second-person modal framing: "you must ...", "you are required to ...". */
const YOU = "\\byou\\s+(?:must|should|need\\s+to|have\\s+to|are\\s+required\\s+to|are\\s+to|will|shall)\\s+";

/** Either framing. Anything matching neither is treated as description, not instruction. */
const DIRECTED = `(?:${IMP}|${YOU})`;

/** Words naming the agent being addressed. */
const AGENT = "(?:you|assistant|ai|agent|model|llm|chatgpt|claude|gpt|system|bot|reviewer|verifier)";

interface Signature {
  id: string;
  severity: PatternHit["severity"];
  label: string;
  pattern: RegExp;
}

const SIGNATURES: Signature[] = [
  // -- instruction override --------------------------------------------------
  {
    id: "injection.override_instructions",
    severity: "critical",
    label: "Instructs the reader to ignore or override prior instructions",
    pattern: new RegExp(
      `${DIRECTED}(?:ignore|disregard|forget|discard|override|bypass|skip)\\s+(?:all\\s+|any\\s+|the\\s+)?(?:previous|prior|earlier|above|preceding|original|system|foregoing)?\\s*(?:instruction|instructions|prompt|prompts|rule|rules|directive|directives|guideline|guidelines|brief|context)\\b`,
      "i",
    ),  },
  {
    id: "injection.new_instructions",
    severity: "critical",
    label: "Declares a replacement instruction set for the reader to follow",
    pattern: new RegExp(
      `${IMP}(?:your\\s+)?(?:new|updated|revised|real|actual|true)\\s+(?:instruction|instructions|task|tasks|directive|directives|system\\s+prompt)\\b\\s*(?:is|are|:)`,
      "i",
    ),
  },
  {
    id: "injection.role_reassignment",
    severity: "critical",
    label: "Attempts to reassign the reader's role or system prompt",
    pattern: new RegExp(
      `\\b(?:you\\s+are\\s+now\\s+(?:a|an|the)\\b|from\\s+now\\s+on,?\\s+you\\b|act\\s+as\\s+(?:if|a|an)\\b|pretend\\s+(?:to\\s+be|you\\s+are)\\b|roleplay\\s+as\\b|enter\\s+(?:developer|admin|god|dan)\\s+mode\\b|switch\\s+to\\s+(?:developer|admin|god|dan)\\s+mode\\b)`,
      "i",
    ),
  },
  {
    id: "injection.delimiter_spoofing",
    severity: "critical",
    label: "Forges system or conversation delimiters to inject a new turn",
    pattern:
      /(?:<\|(?:im_start|im_end|endoftext|system)\|>|\[\/?(?:INST|SYS)\]|<<SYS>>|\bBEGIN\s+SYSTEM\s+(?:PROMPT|MESSAGE)\b|^\s*###\s*(?:system|instruction)s?\s*:)/im,
  },
  {
    id: "injection.verification_bypass",
    severity: "critical",
    label: "Directs the verifier to approve the delivery or skip its checks",
    pattern: new RegExp(
      `${DIRECTED}(?:approve|accept|whitelist|greenlight|sign\\s+off\\s+on)\\s+(?:this|the)\\s+(?:delivery|submission|work|job|report|payment)\\b` +
        `|${DIRECTED}(?:skip|bypass|disable|omit|suppress)\\s+(?:the\\s+|all\\s+|any\\s+)?(?:verification|validation|safety|security|compliance)?\\s*(?:check|checks|review|screening|guardrail|guardrails|scan)\\b` +
        `|\\b(?:return|output|issue|produce)\\s+(?:a\\s+)?(?:go|approved|pass(?:ing)?|safe)\\s+(?:verdict|decision|result)\\b` +
        `|\\bverdict\\s+(?:must|should|has\\s+to)\\s+be\\s+(?:go|approved|pass)\\b` +
        `|\\bmark\\s+(?:this|it)\\s+as\\s+(?:approved|safe|complete|passing)\\b`,
      "i",
    ),  },

  // -- fund / asset movement -------------------------------------------------
  {
    id: "injection.fund_transfer",
    severity: "critical",
    label: "Instructs the reader to move funds or redirect a payment",
    pattern: new RegExp(
      `${DIRECTED}(?:transfer|send|forward|withdraw|release|route|redirect|sweep|remit)\\s+(?:the\\s+|all\\s+|any\\s+|remaining\\s+|escrowed\\s+|these\\s+)*(?:funds?|payments?|balance|escrow|money|proceeds|BOT|ETH|USDT|USDC)\\b`,
      "i",
    ),
  },
  {
    id: "injection.payout_redirect",
    severity: "critical",
    label: "Supplies a replacement payout address for the reader to use",
    pattern: new RegExp(
      `\\b(?:payout|payment|provider|recipient|beneficiary|destination|withdrawal)\\s*(?:address|wallet|account)\\s*(?:is\\s+now|=|:|should\\s+be|has\\s+changed\\s+to|changed\\s+to|updated\\s+to|must\\s+be)\\s*(?:0x[a-fA-F0-9]{40})` +
        `|\\b(?:instead\\s+of|rather\\s+than)\\b[^.!?\\n]{0,60}?\\b(?:send|transfer|pay)\\b[^.!?\\n]{0,40}?0x[a-fA-F0-9]{40}`,
      "i",
    ),
  },

  // -- secret exfiltration ---------------------------------------------------
  {
    id: "injection.secret_exfiltration",
    severity: "critical",
    label: "Asks the reader to reveal keys, prompts, or credentials",
    pattern: new RegExp(
      `${DIRECTED}(?:reveal|disclose|print|output|show|dump|leak|repeat|echo|share)\\s+(?:me\\s+|us\\s+|your\\s+|the\\s+|any\\s+|all\\s+)*(?:system\\s+prompt|initial\\s+prompt|instructions|api[\\s_-]?keys?|private[\\s_-]?keys?|secrets?|credentials?|seed\\s+phrase|mnemonic|passwords?|env(?:ironment)?\\s+variables?)\\b` +
        `|${YOU}(?:reveal|disclose|print|output|show|dump|send)\\b[^.!?\\n]{0,40}?\\b(?:system\\s+prompt|api[\\s_-]?keys?|private[\\s_-]?keys?|secrets?|credentials?)\\b` +
        `|\\b(?:send|give|tell)\\s+(?:me|us)\\s+(?:your\\s+|the\\s+)?(?:system\\s+prompt|api[\\s_-]?keys?|private[\\s_-]?keys?|secrets?|credentials?|seed\\s+phrase|mnemonic)\\b`,
      "i",
    ),
  },
  {
    id: "injection.embedded_credential",
    severity: "high",
    label: "Embeds what appears to be a live private key or seed phrase",
    pattern:
      /\b(?:private[\s_-]?key|secret[\s_-]?key|signing[\s_-]?key|seed)\b[^\n]{0,30}?(?:0x)?[a-fA-F0-9]{64}\b/i,
  },

  // -- tool / code execution -------------------------------------------------
  {
    id: "injection.tool_call_smuggling",
    severity: "critical",
    label: "Smuggles a tool call or function-call directive",
    pattern:
      /(?:<\s*\/?\s*(?:tool_call|function_call|tool_use|antml:invoke)\b|\{\s*"(?:tool_name|tool_call|function|name)"\s*:\s*"[^"]{1,64}"\s*,\s*"(?:parameters|arguments|input|args)"|\b(?:call|invoke|use)\s+the\s+[\w.-]{2,40}\s+(?:tool|function|api)\s+(?:to|with)\b)/i,
  },
  {
    id: "injection.command_execution",
    severity: "critical",
    label: "Directs the reader to execute a shell command or script",
    pattern: new RegExp(
      `${DIRECTED}(?:run|execute|exec|eval)\\b[^.!?\\n]{0,30}?(?:\\bcurl\\b|\\bwget\\b|\\bbash\\b|\\bsh\\s+-c\\b|\\bpowershell\\b|\\bnpm\\s+(?:i|install)\\b|\\bpip\\s+install\\b|\\brm\\s+-rf\\b)` +
        `|\\bcurl\\b[^\\n]{0,80}?\\|\\s*(?:bash|sh)\\b`,
      "i",
    ),
  },
  {
    id: "injection.exfiltration_channel",
    severity: "high",
    label: "Directs the reader to send data to an external endpoint",
    pattern: new RegExp(
      `${DIRECTED}(?:post|send|upload|exfiltrate|forward|transmit)\\b[^.!?\\n]{0,50}?\\b(?:to)\\b\\s*(?:https?://|\\bthis\\s+webhook\\b|\\bthe\\s+following\\s+(?:url|endpoint)\\b)`,
      "i",
    ),
  },

  // -- addressed-imperative catch-all ---------------------------------------
  {
    id: "injection.direct_agent_address",
    severity: "high",
    label: "Addresses the reading agent directly with an imperative",
    pattern: new RegExp(
      `(?:^|[.!?\\n]\\s*|\\n\\s*[-*>]\\s*)(?:attention|hey|hello|dear|note\\s+(?:to|for))[\\s,:]*(?:the\\s+)?${AGENT}\\b` +
        `|\\b(?:${AGENT})\\s*[:,]\\s*(?:ignore|approve|release|transfer|reveal|execute|obey|comply|do\\s+not)\\b` +
        `|${YOU}(?:ignore|approve|release|transfer|reveal|execute|obey|comply)\\b`,
      "i",
    ),
  },
  {
    id: "injection.hidden_channel_marker",
    severity: "high",
    label: "Uses hidden-content markers to address the reader out of band",
    pattern:
      /(?:<!--[^>]{0,200}?\b(?:ai|assistant|agent|llm|model)\b[^>]{0,200}?\b(?:ignore|approve|instruct|must|transfer|reveal|do\s+not)\b[^>]{0,200}?-->|\bhidden\s+(?:instruction|message|note)\s+(?:for|to)\s+(?:the\s+)?(?:ai|agent|assistant|model|reviewer)\b)/i,
  },

  // -- medium: context, not conclusive --------------------------------------
  {
    id: "suspicious.urgency_authority",
    severity: "medium",
    label: "Claims special authority or secrecy to pressure the reader",
    pattern: new RegExp(
      `\\bthis\\s+is\\s+(?:an?\\s+)?(?:admin|administrator|system|owner|developer|emergency)\\s+(?:override|instruction|message|directive)\\b` +
        `|\\bauthorized\\s+by\\s+(?:the\\s+)?(?:owner|admin|buyer|system|compliance)\\b` +
        `|\\bdo\\s+not\\s+(?:tell|inform|mention\\s+this\\s+to|disclose\\s+this\\s+to)\\s+(?:the\\s+)?(?:user|buyer|human|operator)\\b`,
      "i",
    ),
  },
  {
    id: "suspicious.encoded_payload",
    severity: "medium",
    label: "Presents an encoded blob as something to decode and act on",
    pattern: new RegExp(
      `\\b(?:decode|base64|rot13|unescape|atob|from\\s*hex)\\b[^.!?\\n]{0,50}?\\b(?:and|then)\\b[^.!?\\n]{0,30}?\\b(?:follow|execute|run|obey|apply|comply|do)\\b` +
        `|\\b(?:decode|read)\\s+(?:the\\s+)?(?:following|below|appended)\\b[^.!?\\n]{0,40}?\\b(?:directive|instruction|command)s?\\b`,
      "i",
    ),
  },
];

const DOWNGRADE: Record<PatternHit["severity"], PatternHit["severity"]> = {
  critical: "high",
  high: "medium",
  medium: "medium",
};

/** Maximum delivery size accepted for evaluation (characters). */
export const MAX_DELIVERY_CHARS = 60_000;

/**
 * Run every signature across every decoded surface.
 *
 * Surfaces are visited in order of fidelity — raw, normalized, decoded, de-spaced — and the
 * first surface to produce a given signature wins, so an excerpt always comes from the most
 * faithful reading that matched. A hit found only on the de-spaced surface is downgraded one
 * level, since that surface is reconstructed rather than observed.
 */
export function runDeterministicChecks(delivery: string): DeterministicReport {
  const norm = normalizeText(delivery);
  const surfaces = scanSurfaces(delivery);
  const hits: PatternHit[] = [];
  const seen = new Set<string>();

  for (const surface of surfaces) {
    if (!surface.text) continue;
    for (const sig of SIGNATURES) {
      if (seen.has(sig.id)) continue;

      const match = sig.pattern.exec(surface.text);
      if (!match) continue;

      seen.add(sig.id);
      hits.push({
        id: sig.id,
        severity: surface.layer === "despaced" ? DOWNGRADE[sig.severity] : sig.severity,
        layer: surface.layer,
        label: sig.label,
        excerpt: redactExcerpt(surface.text, match.index),
      });
    }
  }

  // Invisible characters inserted mid-word are an evasion technique in their own right, whether
  // or not the hidden text itself matched a signature.
  if (norm.hasIntraWordInvisibles) {
    hits.push({
      id: "evasion.zero_width_obfuscation",
      severity: "high",
      layer: "normalized",
      label: "Hides text using zero-width or bidirectional control characters inside words",
      excerpt: `${norm.invisibleCharsRemoved} invisible character(s) removed before analysis`,
    });
  }

  const blocking = hits.filter((h) => h.severity === "critical" || h.severity === "high");

  return {
    passed: blocking.length === 0,
    hits,
    layersScanned: [...new Set(surfaces.map((s) => s.layer))],
    suspiciousCharacterCount: norm.invisibleCharsRemoved,
    normalizedLength: norm.normalized.length,
  };
}

/** Exposed for tests and documentation. */
export function listSignatures(): Array<Pick<Signature, "id" | "severity" | "label">> {
  return SIGNATURES.map(({ id, severity, label }) => ({ id, severity, label }));
}
