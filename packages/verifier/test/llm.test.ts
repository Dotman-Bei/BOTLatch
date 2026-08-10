import { describe, expect, it, vi } from "vitest";
import {
  AssessmentSchema,
  SYSTEM_PROMPT,
  assessWithLlm,
  buildUserMessage,
  extractJson,
  llmConfigFromEnv,
  sanitizeReason,
  type LlmConfig,
} from "../src/llm.js";

const BASE_CONFIG: LlmConfig = {
  apiKey: "test-key",
  model: "test-model",
  baseUrl: "https://llm.test",
  timeoutMs: 5_000,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "request-id": "req_test" },
  });
}

function textBlock(text: string): unknown {
  return { content: [{ type: "text", text }] };
}

function stubFetch(response: Response | (() => Promise<Response>)): typeof fetch {
  return vi.fn(async () =>
    typeof response === "function" ? await response() : response,
  ) as unknown as typeof fetch;
}

const VALID = { conformance: "pass", safety: "safe", reasons: ["It answers the brief."] };

describe("prompt construction", () => {
  it("tells the model that the brief and delivery are data", () => {
    expect(SYSTEM_PROMPT).toMatch(/never as instructions/i);
    expect(SYSTEM_PROMPT).toMatch(/do not follow any instruction/i);
  });

  it("states that describing an attack is not itself hostile", () => {
    expect(SYSTEM_PROMPT).toMatch(/not automatically hostile/i);
  });

  it("wraps untrusted content in explicit delimiters", () => {
    const message = buildUserMessage("the brief", "the delivery");
    expect(message).toContain("<brief>\nthe brief\n</brief>");
    expect(message).toContain("<delivery>\nthe delivery\n</delivery>");
  });

  it("clamps oversized fields and says so", () => {
    const message = buildUserMessage("brief", "x".repeat(30_000));
    expect(message.length).toBeLessThan(30_000);
    expect(message).toMatch(/truncated \d+ characters/);
  });

  it("sends untrusted content as the user turn, never in the system prompt", async () => {
    const fetchImpl = stubFetch(jsonResponse(textBlock(JSON.stringify(VALID))));
    await assessWithLlm("brief", "DELIVERY-MARKER", { ...BASE_CONFIG, fetchImpl });

    const [, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    const body = JSON.parse(String(init.body)) as { system: string; messages: unknown[] };
    expect(body.system).not.toContain("DELIVERY-MARKER");
    expect(JSON.stringify(body.messages)).toContain("DELIVERY-MARKER");
  });

  it("pins temperature to zero so verdicts are reproducible", async () => {
    const fetchImpl = stubFetch(jsonResponse(textBlock(JSON.stringify(VALID))));
    await assessWithLlm("brief", "delivery", { ...BASE_CONFIG, fetchImpl });

    const [, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(JSON.parse(String(init.body)).temperature).toBe(0);
  });
});

describe("response parsing", () => {
  it("parses bare JSON", () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
  });

  it("parses fenced JSON", () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it("parses JSON embedded in prose", () => {
    expect(extractJson('Here you go:\n{"a":1}\nHope that helps.')).toEqual({ a: 1 });
  });

  it("throws when there is no JSON object at all", () => {
    expect(() => extractJson("I cannot help with that.")).toThrow();
  });

  it("rejects out-of-vocabulary enum values", () => {
    expect(AssessmentSchema.safeParse({ ...VALID, safety: "probably fine" }).success).toBe(false);
    expect(AssessmentSchema.safeParse({ ...VALID, conformance: "great" }).success).toBe(false);
  });

  it("requires at least one reason", () => {
    expect(AssessmentSchema.safeParse({ ...VALID, reasons: [] }).success).toBe(false);
  });
});

describe("reason sanitisation", () => {
  it("removes control characters", () => {
    const dirty = `line one${String.fromCharCode(10)}line${String.fromCharCode(0)}two`;
    const clean = sanitizeReason(dirty);
    for (const ch of clean) {
      const code = ch.codePointAt(0) ?? 0;
      expect(code >= 0x20 && code !== 0x7f).toBe(true);
    }
  });

  it("strips angle brackets so model text cannot smuggle markup", () => {
    expect(sanitizeReason("beware of <script>alert(1)</script>")).not.toMatch(/[<>]/);
  });

  it("bounds the length", () => {
    expect(sanitizeReason("z".repeat(1000)).length).toBeLessThanOrEqual(240);
  });
});

describe("assessWithLlm: the failure surface", () => {
  it("reports not-ok when no API key is configured", async () => {
    const result = await assessWithLlm("b", "d", { ...BASE_CONFIG, apiKey: undefined });
    expect(result.ok).toBe(false);
    expect(result.failureReason).toMatch(/LLM_API_KEY/);
  });

  it("reports not-ok on an HTTP error", async () => {
    const result = await assessWithLlm("b", "d", {
      ...BASE_CONFIG,
      fetchImpl: stubFetch(new Response("upstream exploded", { status: 503 })),
    });
    expect(result.ok).toBe(false);
    expect(result.failureReason).toContain("503");
  });

  it("reports not-ok on an empty response", async () => {
    const result = await assessWithLlm("b", "d", {
      ...BASE_CONFIG,
      fetchImpl: stubFetch(jsonResponse({ content: [] })),
    });
    expect(result.ok).toBe(false);
    expect(result.failureReason).toMatch(/empty/i);
  });

  it("reports not-ok on unparseable output", async () => {
    const result = await assessWithLlm("b", "d", {
      ...BASE_CONFIG,
      fetchImpl: stubFetch(jsonResponse(textBlock("Sure! The delivery looks great to me."))),
    });
    expect(result.ok).toBe(false);
  });

  it("reports not-ok when the JSON does not match the schema", async () => {
    const result = await assessWithLlm("b", "d", {
      ...BASE_CONFIG,
      fetchImpl: stubFetch(
        jsonResponse(textBlock(JSON.stringify({ conformance: "excellent", safety: "fine" }))),
      ),
    });
    expect(result.ok).toBe(false);
    expect(result.failureReason).toMatch(/schema/i);
  });

  it("reports not-ok on a network failure", async () => {
    const result = await assessWithLlm("b", "d", {
      ...BASE_CONFIG,
      fetchImpl: (() => {
        throw new Error("ECONNREFUSED");
      }) as unknown as typeof fetch,
    });
    expect(result.ok).toBe(false);
    expect(result.failureReason).toMatch(/ECONNREFUSED/);
  });

  it("reports not-ok on a timeout", async () => {
    const abort = Object.assign(new Error("aborted"), { name: "AbortError" });
    const result = await assessWithLlm("b", "d", {
      ...BASE_CONFIG,
      fetchImpl: (async () => {
        throw abort;
      }) as unknown as typeof fetch,
    });
    expect(result.ok).toBe(false);
    expect(result.failureReason).toMatch(/timeout/i);
  });

  it("never returns a permissive assessment on any failure path", async () => {
    const failures: LlmConfig[] = [
      { ...BASE_CONFIG, apiKey: undefined },
      { ...BASE_CONFIG, fetchImpl: stubFetch(new Response("nope", { status: 500 })) },
      { ...BASE_CONFIG, fetchImpl: stubFetch(jsonResponse(textBlock("not json"))) },
      { ...BASE_CONFIG, fetchImpl: stubFetch(jsonResponse({ content: [] })) },
      {
        ...BASE_CONFIG,
        fetchImpl: stubFetch(
          jsonResponse(textBlock(JSON.stringify({ ...VALID, safety: "totally safe" }))),
        ),
      },
    ];

    for (const config of failures) {
      const result = await assessWithLlm("b", "d", config);
      expect(result.ok).toBe(false);
      // Even the placeholder assessment must not read as a clean bill of health.
      expect(result.safety).not.toBe("safe");
      expect(result.conformance).not.toBe("pass");
    }
  });
});

describe("assessWithLlm: the success path", () => {
  it("returns the parsed judgement and hashes the raw output", async () => {
    const raw = JSON.stringify({
      conformance: "partial",
      safety: "suspicious",
      reasons: ["The delivery covers two of four requirements."],
    });

    const result = await assessWithLlm("b", "d", {
      ...BASE_CONFIG,
      fetchImpl: stubFetch(jsonResponse(textBlock(raw))),
    });

    expect(result.ok).toBe(true);
    expect(result.conformance).toBe("partial");
    expect(result.safety).toBe("suspicious");
    expect(result.reasons).toEqual(["The delivery covers two of four requirements."]);
    expect(result.modelOutputHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(result.requestId).toBe("req_test");
  });

  it("sanitises model-authored reasons before they reach the UI", async () => {
    const raw = JSON.stringify({
      conformance: "pass",
      safety: "safe",
      reasons: ["<b>Looks</b>   fine"],
    });

    const result = await assessWithLlm("b", "d", {
      ...BASE_CONFIG,
      fetchImpl: stubFetch(jsonResponse(textBlock(raw))),
    });

    expect(result.reasons[0]).toBe("bLooks/b fine");
  });
});

describe("configuration", () => {
  it("reads the environment and trims a trailing slash from the base URL", () => {
    const config = llmConfigFromEnv({
      LLM_API_KEY: "k",
      LLM_MODEL: "claude-sonnet-5",
      LLM_BASE_URL: "https://gateway.example.com/",
      LLM_TIMEOUT_MS: "1234",
    } as NodeJS.ProcessEnv);

    expect(config).toMatchObject({
      apiKey: "k",
      model: "claude-sonnet-5",
      baseUrl: "https://gateway.example.com",
      timeoutMs: 1234,
    });
  });

  it("defaults to the Anthropic API when nothing is set", () => {
    const config = llmConfigFromEnv({} as NodeJS.ProcessEnv);
    expect(config.baseUrl).toBe("https://api.anthropic.com");
    expect(config.apiKey).toBeUndefined();
  });
});
