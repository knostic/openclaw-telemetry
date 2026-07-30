import { describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  service: {
    id: "telemetry",
    write: vi.fn(),
  },
}));

vi.mock("./src/service.js", () => ({
  createTelemetryService: () => mocks.service,
}));

import plugin from "./index.js";

type HookHandler = (
  event: Record<string, unknown>,
  context: Record<string, unknown>,
) => void;

describe("telemetry plugin registration", () => {
  test("records prompt inspection through before_prompt_build", () => {
    const handlers = new Map<string, HookHandler>();
    const api = {
      registerService: vi.fn(),
      on: vi.fn((hookName: string, handler: HookHandler) => {
        handlers.set(hookName, handler);
      }),
    };

    plugin.register(api as never);

    expect(api.registerService).toHaveBeenCalledWith(mocks.service);
    expect(handlers.has("before_agent_start")).toBe(false);
    expect(handlers.has("before_prompt_build")).toBe(true);

    handlers.get("before_prompt_build")?.(
      { prompt: "hello", messages: [] },
      { sessionKey: "session-1", agentId: "agent-1" },
    );

    expect(mocks.service.write).toHaveBeenCalledWith({
      type: "agent.start",
      sessionKey: "session-1",
      agentId: "agent-1",
      promptLength: 5,
    });
  });
});
