import * as dgram from "node:dgram";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createSyslogWriter } from "./syslog.js";
import type { TelemetryEvent } from "./types.js";

describe("SyslogWriter", () => {
  let server: dgram.Socket;
  let messages: string[];
  let port: number;

  beforeEach(async () => {
    messages = [];
    server = dgram.createSocket("udp4");

    await new Promise<void>((resolve) => {
      server.on("message", (msg) => {
        messages.push(msg.toString());
      });
      server.bind(0, "127.0.0.1", () => {
        const addr = server.address();
        port = typeof addr === "string" ? 514 : addr.port;
        resolve();
      });
    });
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  test("sends CEF formatted syslog message", async () => {
    const writer = createSyslogWriter({
      enabled: true,
      host: "127.0.0.1",
      port,
      protocol: "udp",
      format: "cef",
    });

    const event: TelemetryEvent = {
      type: "tool.start",
      toolName: "bash",
      params: { cmd: "ls" },
      seq: 1,
      ts: Date.now(),
      sessionKey: "test-session",
    };

    writer.write(event);
    await new Promise((r) => setTimeout(r, 50));
    await writer.close();

    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("CEF:0|OpenClaw|openclaw|1.0|1001|Tool Invocation Started|");
    expect(messages[0]).toContain("act=bash");
    expect(messages[0]).toContain("cs1=test-session");
  });

  test("sends JSON formatted syslog message", async () => {
    const writer = createSyslogWriter({
      enabled: true,
      host: "127.0.0.1",
      port,
      protocol: "udp",
      format: "json",
    });

    const event: TelemetryEvent = {
      type: "tool.end",
      toolName: "bash",
      success: true,
      durationMs: 100,
      seq: 1,
      ts: 1700000000000,
    };

    writer.write(event);
    await new Promise((r) => setTimeout(r, 50));
    await writer.close();

    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('"type":"tool.end"');
    expect(messages[0]).toContain('"success":true');
  });

  test("uses error severity for failed events", async () => {
    const writer = createSyslogWriter({
      enabled: true,
      host: "127.0.0.1",
      port,
      protocol: "udp",
      format: "cef",
    });

    const event: TelemetryEvent = {
      type: "tool.end",
      toolName: "bash",
      success: false,
      error: "command failed",
      seq: 1,
      ts: Date.now(),
    };

    writer.write(event);
    await new Promise((r) => setTimeout(r, 50));
    await writer.close();

    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("|7|");
    expect(messages[0]).toContain("outcome=failure");
  });

  test("handles all event types", async () => {
    const writer = createSyslogWriter({
      enabled: true,
      host: "127.0.0.1",
      port,
      protocol: "udp",
      format: "cef",
    });

    const events: TelemetryEvent[] = [
      { type: "tool.start", toolName: "test", params: {}, seq: 1, ts: Date.now() },
      { type: "tool.end", toolName: "test", success: true, seq: 2, ts: Date.now() },
      { type: "message.in", channel: "telegram", from: "user1", contentLength: 50, seq: 3, ts: Date.now() },
      { type: "message.out", channel: "telegram", to: "user1", success: true, seq: 4, ts: Date.now() },
      { type: "llm.usage", provider: "openai", model: "gpt-4", inputTokens: 100, outputTokens: 50, seq: 5, ts: Date.now() },
      { type: "agent.start", promptLength: 500, seq: 6, ts: Date.now() },
      { type: "agent.end", success: true, durationMs: 1000, seq: 7, ts: Date.now() },
    ];

    for (const evt of events) {
      writer.write(evt);
    }
    await new Promise((r) => setTimeout(r, 100));
    await writer.close();

    expect(messages).toHaveLength(7);
  });
});
