import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("openclaw/plugin-sdk", async () => {
  const actual = await vi.importActual<typeof import("openclaw/plugin-sdk")>("openclaw/plugin-sdk");
  return {
    ...actual,
    onDiagnosticEvent: vi.fn(() => vi.fn()),
  };
});

import { createTelemetryService } from "./service.js";

const TEST_DIR = join(import.meta.dirname, ".test-output-service");

describe("TelemetryService", () => {
  beforeEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  afterEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  test("does not write when disabled", async () => {
    const svc = createTelemetryService();
    await svc.start({
      config: { plugins: { entries: { telemetry: { config: { enabled: false } } } } },
      stateDir: TEST_DIR,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    svc.write({ type: "tool.start", toolName: "test", params: {} });
    await svc.stop?.({} as never);
  });

  test("writes events when enabled", async () => {
    const filePath = join(TEST_DIR, "logs", "telemetry.jsonl");
    const svc = createTelemetryService();
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    await svc.start({
      config: { plugins: { entries: { telemetry: { config: { enabled: true, filePath } } } } },
      stateDir: TEST_DIR,
      logger,
    });

    svc.write({ type: "tool.start", toolName: "bash", params: { cmd: "ls" } });
    svc.write({ type: "tool.end", toolName: "bash", success: true, durationMs: 50 });
    await svc.stop?.({} as never);

    const content = await readFile(filePath, "utf-8");
    const lines = content.trim().split("\n");
    expect(lines).toHaveLength(2);

    const start = JSON.parse(lines[0]);
    expect(start.type).toBe("tool.start");
    expect(start.toolName).toBe("bash");

    const end = JSON.parse(lines[1]);
    expect(end.type).toBe("tool.end");
    expect(end.success).toBe(true);

    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining("telemetry:"));
  });

  test("uses default path when filePath not specified", async () => {
    const svc = createTelemetryService();
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    await svc.start({
      config: { plugins: { entries: { telemetry: { config: { enabled: true } } } } },
      stateDir: TEST_DIR,
      logger,
    });

    svc.write({ type: "agent.start", promptLength: 100 });
    await svc.stop?.({} as never);

    const defaultPath = join(TEST_DIR, "logs", "telemetry.jsonl");
    const content = await readFile(defaultPath, "utf-8");
    expect(content).toContain('"type":"agent.start"');
  });
});
