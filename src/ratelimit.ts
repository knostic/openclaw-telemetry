import type { RateLimitConfig } from "./types.js";

export function createRateLimiter(config: RateLimitConfig = {}) {
  if (!config.enabled) {
    return {
      allow: () => true,
      dropped: () => 0,
    };
  }

  const rate = config.maxEventsPerSecond ?? 100;
  const burst = config.burstSize ?? rate * 2;
  let tokens = burst;
  let lastRefill = Date.now();
  let droppedCount = 0;

  function refill() {
    const now = Date.now();
    const elapsed = (now - lastRefill) / 1000;
    tokens = Math.min(burst, tokens + elapsed * rate);
    lastRefill = now;
  }

  return {
    allow(): boolean {
      refill();
      if (tokens >= 1) {
        tokens--;
        return true;
      }
      droppedCount++;
      return false;
    },
    dropped(): number {
      return droppedCount;
    },
  };
}
