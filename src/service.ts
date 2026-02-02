import type { OpenClawPluginService } from "openclaw/plugin-sdk";
import { onDiagnosticEvent } from "openclaw/plugin-sdk";
import { createIntegrityChain } from "./integrity.js";
import { createRateLimiter } from "./ratelimit.js";
import { createRedactor } from "./redact.js";
import { createSyslogWriter, type SyslogWriter } from "./syslog.js";
import type { TelemetryConfig, TelemetryEvent, TelemetryEventInput } from "./types.js";
import { createTelemetryWriter, type TelemetryWriter } from "./writer.js";

export type TelemetryService = OpenClawPluginService & {
  write: (evt: TelemetryEventInput) => void;
};

export function createTelemetryService(): TelemetryService {
  let fileWriter: TelemetryWriter | null = null;
  let syslogWriter: SyslogWriter | null = null;
  let unsubDiag: (() => void) | null = null;
  let redactor = createRedactor();
  let integrity = createIntegrityChain();
  let rateLimiter = createRateLimiter();
  let seq = 0;

  const writeEvent = (evt: TelemetryEventInput) => {
    if (!rateLimiter.allow()) {
      return;
    }
    const redacted = redactor.redact(evt);
    const enriched: TelemetryEvent = {
      ...redacted,
      seq: ++seq,
      ts: Date.now(),
    } as TelemetryEvent;
    const signed = integrity.sign(enriched);

    fileWriter?.write(signed);
    syslogWriter?.write(signed);
  };

  return {
    id: "telemetry",
    write: writeEvent,
    async start(ctx) {
      const cfg = ctx.config.plugins?.telemetry as TelemetryConfig | undefined;
      if (!cfg?.enabled) {
        return;
      }

      const filePath = cfg.filePath ?? `${ctx.stateDir}/logs/telemetry.jsonl`;
      fileWriter = createTelemetryWriter(filePath, cfg.rotate);
      ctx.logger.info(`telemetry: writing to ${filePath}`);

      if (cfg.rotate?.enabled) {
        const maxMB = (cfg.rotate.maxSizeBytes ?? 10 * 1024 * 1024) / 1024 / 1024;
        ctx.logger.info(`telemetry: rotation enabled (max ${maxMB}MB, keep ${cfg.rotate.maxFiles ?? 5} files)`);
      }

      if (cfg.redact?.enabled) {
        redactor = createRedactor(cfg.redact);
        ctx.logger.info("telemetry: redaction enabled");
      }

      if (cfg.integrity?.enabled) {
        integrity = createIntegrityChain(cfg.integrity);
        ctx.logger.info(`telemetry: integrity chain enabled (${cfg.integrity.algorithm ?? "sha256"})`);
      }

      if (cfg.rateLimit?.enabled) {
        rateLimiter = createRateLimiter(cfg.rateLimit);
        ctx.logger.info(
          `telemetry: rate limiting enabled (${cfg.rateLimit.maxEventsPerSecond ?? 100}/s, burst ${cfg.rateLimit.burstSize ?? 200})`,
        );
      }

      if (cfg.syslog?.enabled && cfg.syslog.host) {
        syslogWriter = createSyslogWriter(cfg.syslog);
        ctx.logger.info(
          `telemetry: syslog enabled (${cfg.syslog.protocol ?? "udp"}://${cfg.syslog.host}:${cfg.syslog.port ?? 514})`,
        );
      }

      unsubDiag = onDiagnosticEvent((evt) => {
        if (evt.type === "model.usage") {
          writeEvent({
            type: "llm.usage",
            sessionKey: evt.sessionKey,
            provider: evt.provider,
            model: evt.model,
            inputTokens: evt.usage.input,
            outputTokens: evt.usage.output,
            cacheTokens: evt.usage.cacheRead,
            durationMs: evt.durationMs,
            costUsd: evt.costUsd,
          });
        }
      });
    },
    async stop() {
      unsubDiag?.();
      unsubDiag = null;
      await fileWriter?.flush();
      fileWriter = null;
      await syslogWriter?.close();
      syslogWriter = null;
    },
  };
}
