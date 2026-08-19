import { describe, it, afterEach, expect } from "vitest";
import {
  OpenAICompatibleLlmProvider,
  LlmProviderError,
} from "../src/llm/provider.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("OpenAICompatibleLlmProvider", () => {
  it("returns a validated LLM report from a chat completion", async () => {
    let requestBody: Record<string, unknown> | undefined;
    globalThis.fetch = (async (_url, init) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({
              summary: "The package behavior matches its description.",
              functionalMatch: true,
              suspiciousScore: 12,
              findings: [{
                ruleId: "llm-network",
                ruleName: "Unexpected network behavior",
                severity: "high",
                message: "The README requests an unexplained remote script.",
                recommendation: "Verify the remote script source.",
                category: "informational",
              }],
            }),
          },
        }],
      }), { status: 200 });
    }) as typeof fetch;

    const provider = new OpenAICompatibleLlmProvider({
      apiKey: "test-key",
      baseUrl: "https://llm.example/v1",
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
    expect(requestBody?.model).toBe("gpt-4o-mini");
  });

  it("is disabled without an API key", async () => {
    const provider = new OpenAICompatibleLlmProvider({ apiKey: "" });
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
      choices: [{ message: { content: "not json" } }],
    }), { status: 200 })) as typeof fetch;
    const provider = new OpenAICompatibleLlmProvider({ apiKey: "test-key" });
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
});
