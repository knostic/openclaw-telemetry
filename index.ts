import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { createTelemetryService, type TelemetryService } from "./src/service.js";

// Module-level singleton so re-registrations share the same service instance.
// OpenClaw may call register() multiple times per plugin lifetime (e.g., CLI
// metadata vs gateway full load); keeping svc at module scope ensures hooks
// reference the same service that receives start()/stop().
let svc: TelemetryService | null = null;

export default {
  id: "telemetry",
  name: "OpenClaw Telemetry",
  description: "Captures tool calls, LLM usage, and message events to JSONL",
  register(api: OpenClawPluginApi) {
    if (!svc) svc = createTelemetryService();
    api.registerService(svc);
    const s = svc;

    api.on("before_tool_call", (evt, ctx) => {
      s.write({
        type: "tool.start",
        toolName: evt.toolName,
        params: evt.params,
        sessionKey: ctx.sessionKey,
        agentId: ctx.agentId,
      });
    });

    api.on("after_tool_call", (evt, ctx) => {
      s.write({
        type: "tool.end",
        toolName: evt.toolName,
        durationMs: evt.durationMs,
        success: !evt.error,
        error: evt.error,
        sessionKey: ctx.sessionKey,
        agentId: ctx.agentId,
      });
    });

    api.on("message_received", (evt, ctx) => {
      s.write({
        type: "message.in",
        channel: ctx.channelId,
        from: evt.from,
        contentLength: evt.content.length,
      });
    });

    api.on("message_sent", (evt, ctx) => {
      s.write({
        type: "message.out",
        channel: ctx.channelId,
        to: evt.to,
        success: evt.success,
        error: evt.error,
      });
    });

    api.on("before_agent_start", (evt, ctx) => {
      s.write({
        type: "agent.start",
        sessionKey: ctx.sessionKey,
        agentId: ctx.agentId,
        promptLength: evt.prompt.length,
      });
    });

    api.on("agent_end", (evt, ctx) => {
      s.write({
        type: "agent.end",
        sessionKey: ctx.sessionKey,
        agentId: ctx.agentId,
        success: evt.success,
        durationMs: evt.durationMs,
        error: evt.error,
      });
    });
  },
};
