import { describe, it, afterEach, expect } from "vitest";
import {
  GeminiLlmProvider,
  LlmProviderError,
} from "../src/llm/provider.js";
import { SYSTEM_PROMPT } from "../src/llm/parse.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("GeminiLlmProvider", () => {
  it("returns a validated LLM report from a generateContent call", async () => {
    let requestUrl: string | undefined;
    let requestHeaders: Record<string, string> | undefined;
    let requestBody: Record<string, unknown> | undefined;
    globalThis.fetch = (async (url, init) => {
      requestUrl = String(url);
      requestHeaders = init?.headers as Record<string, string>;
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({
        candidates: [
          {
            content: {
              role: "model",
              parts: [
                {
                  text: JSON.stringify({
                    summary: "OK",
                    functionalMatch: true,
                    suspiciousScore: 12,
                    findings: [
                      {
                        ruleId: "llm-x",
                        ruleName: "X",
                        severity: "high",
                        message: "M",
                        category: "informational",
                      },
                    ],
                  }),
                },
              ],
            },
            finishReason: "STOP",
          },
        ],
      }), { status: 200 });
    }) as typeof fetch;

    const provider = new GeminiLlmProvider({
      apiKey: "test-key",
      model: "gemini-2.0-flash",
    });
    const report = await provider.scan({
      packageName: "demo",
      version: "1.0.0",
      description: "Demo package",
      readme: "README",
    });

    expect(report.enabled).toBe(true);
    expect(report.suspiciousScore).toBe(12);
    expect(report.findings?.[0]?.severity).toBe("high");

    expect(
      requestUrl?.endsWith(":generateContent"),
    ).toBeTruthy();
    expect(
      requestUrl?.includes("gemini-2.0-flash"),
    ).toBeTruthy();
    expect(requestHeaders?.["x-goog-api-key"]).toBe("test-key");

    const contents = requestBody?.contents as unknown[];
    const systemInstruction = requestBody?.systemInstruction as {
      parts: { text: string }[];
    };
    const generationConfig = requestBody?.generationConfig as {
      responseMimeType: string;
      temperature: number;
    };
    expect(
      (contents?.[0] as { parts: { text: string }[] })?.parts?.[0]?.text,
    ).toBe(JSON.stringify({
      packageName: "demo",
      version: "1.0.0",
      description: "Demo package",
      readme: "README",
      packageJson: undefined,
    }));
    expect(systemInstruction?.parts?.[0]?.text).toBe(SYSTEM_PROMPT);
    expect(generationConfig?.responseMimeType).toBe("application/json");
    expect(generationConfig?.temperature).toBe(0);
  });

  it("is disabled without an API key", async () => {
    const provider = new GeminiLlmProvider({ apiKey: "" });
    const report = await provider.scan({
      packageName: "demo",
      version: "1.0.0",
      description: "",
      readme: "",
    });
    expect(report).toEqual({
      enabled: false,
      reason: "LLM provider is not configured.",
    });
  });

  it("rejects malformed model responses", async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: "not json" }] } }],
    }), { status: 200 })) as typeof fetch;
    const provider = new GeminiLlmProvider({ apiKey: "test-key" });
    try {
      await provider.scan({
        packageName: "demo",
        version: "1.0.0",
        description: "",
        readme: "",
      });
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(LlmProviderError);
      expect((error as LlmProviderError).message).toContain("invalid JSON");
    }
  });

  it("throws when response has no content", async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({
      candidates: [],
    }), { status: 200 })) as typeof fetch;
    const provider = new GeminiLlmProvider({ apiKey: "test-key" });
    try {
      await provider.scan({
        packageName: "demo",
        version: "1.0.0",
        description: "",
        readme: "",
      });
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(LlmProviderError);
      expect((error as LlmProviderError).message).toContain("no content");
    }
  });
});
