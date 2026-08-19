import { describe, it, afterEach, expect } from "vitest";
import {
  AnthropicLlmProvider,
  LlmProviderError,
} from "../src/llm/provider.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("AnthropicLlmProvider", () => {
  it("returns a validated LLM report from a messages call", async () => {
    let requestUrl: URL | undefined;
    let requestHeaders: Headers | undefined;
    let requestBody: Record<string, unknown> | undefined;
    globalThis.fetch = (async (url, init) => {
      requestUrl = new URL(String(url));
      requestHeaders = new Headers(init?.headers);
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({
        content: [{
          type: "text",
          text: JSON.stringify({
            summary: "OK",
            functionalMatch: true,
            suspiciousScore: 7,
            findings: [{
              ruleId: "llm-y",
              ruleName: "Y",
              severity: "medium",
              message: "M",
              category: "suspicious-dependency",
            }],
          }),
        }],
        model: "claude-3-5-sonnet-latest",
        role: "assistant",
        stop_reason: "end_turn",
      }), { status: 200 });
    }) as typeof fetch;

    const provider = new AnthropicLlmProvider({
      apiKey: "test-key",
      baseUrl: "https://api.anthropic.com",
    });
    const report = await provider.scan({
      packageName: "demo",
      version: "1.0.0",
      description: "Demo package",
      readme: "README",
    });

    expect(report.enabled).toBe(true);
    expect(report.suspiciousScore).toBe(7);
    expect(report.findings?.[0]?.severity).toBe("medium");

    expect(
      requestUrl?.href.endsWith("/v1/messages"),
    ).toBeTruthy();
    expect(requestHeaders?.get("x-api-key")).toBe("test-key");
    expect(requestHeaders?.get("anthropic-version")).toBe("2023-06-01");

    expect(requestBody?.model).toBe("claude-3-5-sonnet-latest");
    expect(typeof requestBody?.max_tokens).toBe("number");
    expect(requestBody?.max_tokens).toBe(4096);
    expect(requestBody?.temperature).toBe(0);
    expect(typeof requestBody?.system).toBe("string");
    expect(
      String(requestBody?.system).includes("npm package security analyst"),
    ).toBeTruthy();
    const messages = requestBody?.messages as { role: string; content: string }[] | undefined;
    expect(messages?.[0]?.role).toBe("user");
    expect(typeof messages?.[0]?.content).toBe("string");
    const content = JSON.parse(String(messages?.[0]?.content)) as Record<string, unknown>;
    expect(content.packageName).toBe("demo");
    expect(content.version).toBe("1.0.0");
    expect(content.description).toBe("Demo package");
    expect(content.readme).toBe("README");
  });

  it("is disabled without an API key", async () => {
    const provider = new AnthropicLlmProvider({ apiKey: "" });
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
      content: [{ type: "text", text: "not json" }],
    }), { status: 200 })) as typeof fetch;
    const provider = new AnthropicLlmProvider({ apiKey: "test-key" });
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
      content: [],
    }), { status: 200 })) as typeof fetch;
    const provider = new AnthropicLlmProvider({ apiKey: "test-key" });
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
