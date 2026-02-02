import { describe, expect, test } from "vitest";
import { createRedactor } from "./redact.js";

describe("createRedactor", () => {
  test("returns identity when disabled", () => {
    const r = createRedactor({ enabled: false });
    const input = { apiKey: "sk-1234567890abcdef1234567890abcdef" };
    expect(r.redact(input)).toEqual(input);
  });

  test("redacts OpenAI API keys", () => {
    const r = createRedactor({ enabled: true });
    const input = { key: "sk-1234567890abcdef1234567890abcdef" };
    expect(r.redact(input)).toEqual({ key: "[REDACTED]" });
  });

  test("redacts GitHub tokens", () => {
    const r = createRedactor({ enabled: true });
    const input = { token: "ghp_abcdefghijklmnopqrstuvwxyz1234567890" };
    expect(r.redact(input)).toEqual({ token: "[REDACTED]" });
  });

  test("redacts bearer tokens", () => {
    const r = createRedactor({ enabled: true });
    const input = { auth: "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9" };
    expect(r.redact(input)).toEqual({ auth: "[REDACTED]" });
  });

  test("redacts api_key patterns in strings", () => {
    const r = createRedactor({ enabled: true });
    const input = { cmd: 'curl -H "api_key: abcdef1234567890abcdef"' };
    expect(r.redact(input).cmd).toContain("[REDACTED]");
  });

  test("redacts password patterns", () => {
    const r = createRedactor({ enabled: true });
    const input = { config: 'password="secretpassword123"' };
    expect(r.redact(input).config).toContain("[REDACTED]");
  });

  test("redacts nested objects", () => {
    const r = createRedactor({ enabled: true });
    const input = {
      outer: {
        inner: { key: "sk-1234567890abcdef1234567890abcdef" },
      },
    };
    expect(r.redact(input)).toEqual({
      outer: { inner: { key: "[REDACTED]" } },
    });
  });

  test("redacts arrays", () => {
    const r = createRedactor({ enabled: true });
    const input = { tokens: ["sk-abc123def456ghi789jkl012mno345pq", "normal"] };
    const result = r.redact(input);
    expect(result.tokens[0]).toBe("[REDACTED]");
    expect(result.tokens[1]).toBe("normal");
  });

  test("uses custom patterns", () => {
    const r = createRedactor({
      enabled: true,
      patterns: ["secret-[0-9]+"],
    });
    const input = { id: "secret-12345" };
    expect(r.redact(input)).toEqual({ id: "[REDACTED]" });
  });

  test("uses custom replacement", () => {
    const r = createRedactor({
      enabled: true,
      replacement: "***",
    });
    const input = { key: "sk-1234567890abcdef1234567890abcdef" };
    expect(r.redact(input)).toEqual({ key: "***" });
  });

  test("preserves non-string values", () => {
    const r = createRedactor({ enabled: true });
    const input = { count: 42, active: true, empty: null };
    expect(r.redact(input)).toEqual({ count: 42, active: true, empty: null });
  });
});
