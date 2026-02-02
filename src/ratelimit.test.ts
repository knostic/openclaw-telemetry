import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { createRateLimiter } from "./ratelimit.js";

describe("createRateLimiter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("allows all when disabled", () => {
    const limiter = createRateLimiter({ enabled: false });
    for (let i = 0; i < 1000; i++) {
      expect(limiter.allow()).toBe(true);
    }
    expect(limiter.dropped()).toBe(0);
  });

  test("allows up to burst size initially", () => {
    const limiter = createRateLimiter({ enabled: true, maxEventsPerSecond: 10, burstSize: 20 });
    for (let i = 0; i < 20; i++) {
      expect(limiter.allow()).toBe(true);
    }
    expect(limiter.allow()).toBe(false);
  });

  test("refills tokens over time", () => {
    const limiter = createRateLimiter({ enabled: true, maxEventsPerSecond: 10, burstSize: 10 });

    for (let i = 0; i < 10; i++) {
      limiter.allow();
    }
    expect(limiter.allow()).toBe(false);

    vi.advanceTimersByTime(1000);
    for (let i = 0; i < 10; i++) {
      expect(limiter.allow()).toBe(true);
    }
  });

  test("tracks dropped count", () => {
    const limiter = createRateLimiter({ enabled: true, maxEventsPerSecond: 5, burstSize: 5 });

    for (let i = 0; i < 5; i++) {
      limiter.allow();
    }
    expect(limiter.dropped()).toBe(0);

    for (let i = 0; i < 3; i++) {
      limiter.allow();
    }
    expect(limiter.dropped()).toBe(3);
  });

  test("uses defaults when not specified", () => {
    const limiter = createRateLimiter({ enabled: true });
    let allowed = 0;
    for (let i = 0; i < 300; i++) {
      if (limiter.allow()) allowed++;
    }
    expect(allowed).toBe(200);
  });

  test("partial refill after partial second", () => {
    const limiter = createRateLimiter({ enabled: true, maxEventsPerSecond: 10, burstSize: 10 });

    for (let i = 0; i < 10; i++) {
      limiter.allow();
    }

    vi.advanceTimersByTime(500);
    let allowed = 0;
    for (let i = 0; i < 10; i++) {
      if (limiter.allow()) allowed++;
    }
    expect(allowed).toBe(5);
  });
});
