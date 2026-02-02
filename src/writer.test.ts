import { readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createTelemetryWriter } from "./writer.js";

const TEST_DIR = join(import.meta.dirname, ".test-output");

describe("TelemetryWriter", () => {
  beforeEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  afterEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  test("writes JSONL events to file", async () => {
    const filePath = join(TEST_DIR, "telemetry.jsonl");
    const writer = createTelemetryWriter(filePath);

    writer.write({ type: "test.event", value: 1, seq: 1, ts: 1000 });
    writer.write({ type: "test.event", value: 2, seq: 2, ts: 2000 });
    await writer.flush();

    const content = await readFile(filePath, "utf-8");
    const lines = content.trim().split("\n");
    expect(lines).toHaveLength(2);

    const event1 = JSON.parse(lines[0]);
    expect(event1.type).toBe("test.event");
    expect(event1.value).toBe(1);
    expect(event1.seq).toBe(1);
    expect(event1.ts).toBe(1000);

    const event2 = JSON.parse(lines[1]);
    expect(event2.type).toBe("test.event");
    expect(event2.value).toBe(2);
    expect(event2.seq).toBe(2);
  });

  test("creates directory if missing", async () => {
    const filePath = join(TEST_DIR, "nested", "logs", "telemetry.jsonl");
    const writer = createTelemetryWriter(filePath);

    writer.write({ type: "test", seq: 1, ts: Date.now() });
    await writer.flush();

    const info = await stat(filePath);
    expect(info.isFile()).toBe(true);
  });

  test("flush waits for pending writes", async () => {
    const filePath = join(TEST_DIR, "telemetry.jsonl");
    const writer = createTelemetryWriter(filePath);

    for (let i = 0; i < 10; i++) {
      writer.write({ i, seq: i + 1, ts: Date.now() });
    }
    await writer.flush();

    const content = await readFile(filePath, "utf-8");
    const lines = content.trim().split("\n");
    expect(lines).toHaveLength(10);
  });
});
