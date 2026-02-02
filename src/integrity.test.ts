import { createHash } from "node:crypto";
import { describe, expect, test } from "vitest";
import { createIntegrityChain } from "./integrity.js";
import type { TelemetryEvent } from "./types.js";

describe("createIntegrityChain", () => {
  test("returns identity when disabled", () => {
    const chain = createIntegrityChain({ enabled: false });
    const evt: TelemetryEvent = { type: "tool.start", toolName: "test", params: {}, seq: 1, ts: 1000 };
    const result = chain.sign(evt);
    expect(result).toEqual(evt);
    expect(result).not.toHaveProperty("hash");
  });

  test("adds hash and prevHash when enabled", () => {
    const chain = createIntegrityChain({ enabled: true });
    const evt: TelemetryEvent = { type: "tool.start", toolName: "test", params: {}, seq: 1, ts: 1000 };
    const result = chain.sign(evt);
    expect(result).toHaveProperty("hash");
    expect(result).toHaveProperty("prevHash");
    expect(result.hash).toMatch(/^[a-f0-9]{64}$/);
  });

  test("first event has zero prevHash", () => {
    const chain = createIntegrityChain({ enabled: true });
    const evt: TelemetryEvent = { type: "tool.start", toolName: "test", params: {}, seq: 1, ts: 1000 };
    const result = chain.sign(evt);
    expect(result.prevHash).toBe("0".repeat(64));
  });

  test("chains events correctly", () => {
    const chain = createIntegrityChain({ enabled: true });
    const evt1: TelemetryEvent = { type: "tool.start", toolName: "test", params: {}, seq: 1, ts: 1000 };
    const evt2: TelemetryEvent = { type: "tool.end", toolName: "test", success: true, seq: 2, ts: 2000 };

    const result1 = chain.sign(evt1);
    const result2 = chain.sign(evt2);

    expect(result2.prevHash).toBe(result1.hash);
  });

  test("hash is deterministic for same input", () => {
    const chain1 = createIntegrityChain({ enabled: true });
    const chain2 = createIntegrityChain({ enabled: true });
    const evt: TelemetryEvent = { type: "tool.start", toolName: "test", params: {}, seq: 1, ts: 1000 };

    const result1 = chain1.sign(evt);
    const result2 = chain2.sign(evt);

    expect(result1.hash).toBe(result2.hash);
  });

  test("different events produce different hashes", () => {
    const chain = createIntegrityChain({ enabled: true });
    const evt1: TelemetryEvent = { type: "tool.start", toolName: "test1", params: {}, seq: 1, ts: 1000 };
    const evt2: TelemetryEvent = { type: "tool.start", toolName: "test2", params: {}, seq: 1, ts: 1000 };

    const chain2 = createIntegrityChain({ enabled: true });
    const result1 = chain.sign(evt1);
    const result2 = chain2.sign(evt2);

    expect(result1.hash).not.toBe(result2.hash);
  });

  test("verifiable hash chain", () => {
    const chain = createIntegrityChain({ enabled: true });
    const events: TelemetryEvent[] = [
      { type: "tool.start", toolName: "test", params: {}, seq: 1, ts: 1000 },
      { type: "tool.end", toolName: "test", success: true, seq: 2, ts: 2000 },
      { type: "agent.end", success: true, seq: 3, ts: 3000 },
    ];

    const signed = events.map((e) => chain.sign(e));

    for (let i = 0; i < signed.length; i++) {
      const evt = signed[i];
      const expectedPrev = i === 0 ? "0".repeat(64) : signed[i - 1].hash;
      expect(evt.prevHash).toBe(expectedPrev);

      const { hash, prevHash, ...evtWithoutHashes } = evt;
      const h = createHash("sha256");
      h.update(prevHash);
      h.update(JSON.stringify(evtWithoutHashes));
      expect(hash).toBe(h.digest("hex"));
    }
  });
});
