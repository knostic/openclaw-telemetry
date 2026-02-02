import * as dgram from "node:dgram";
import * as net from "node:net";
import * as tls from "node:tls";
import type { SyslogConfig, TelemetryEvent } from "./types.js";

type SignedEvent = TelemetryEvent & { prevHash?: string; hash?: string };

export type SyslogWriter = {
  write: (evt: SignedEvent) => void;
  close: () => Promise<void>;
};

const FACILITY_LOCAL0 = 16;
const SEVERITY_INFO = 6;
const SEVERITY_ERROR = 3;

function getSeverity(evt: SignedEvent): number {
  if (evt.type === "tool.end" && !evt.success) {
    return SEVERITY_ERROR;
  }
  if (evt.type === "message.out" && !evt.success) {
    return SEVERITY_ERROR;
  }
  if (evt.type === "agent.end" && !evt.success) {
    return SEVERITY_ERROR;
  }
  return SEVERITY_INFO;
}

function escapeCef(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/=/g, "\\=").replace(/\|/g, "\\|");
}

function toCefExtension(evt: SignedEvent): string {
  const parts: string[] = [];
  const add = (key: string, value: string | number | boolean | undefined) => {
    if (value !== undefined && value !== null && value !== "") {
      parts.push(`${key}=${typeof value === "string" ? escapeCef(value) : value}`);
    }
  };

  add("rt", evt.ts);
  add("cs1", evt.sessionKey);
  add("cs1Label", evt.sessionKey ? "sessionKey" : undefined);
  add("cs2", evt.agentId);
  add("cs2Label", evt.agentId ? "agentId" : undefined);
  add("cs5", evt.hash);
  add("cs5Label", evt.hash ? "hash" : undefined);
  add("cs6", evt.prevHash);
  add("cs6Label", evt.prevHash ? "prevHash" : undefined);

  switch (evt.type) {
    case "tool.start":
      add("act", evt.toolName);
      add("msg", JSON.stringify(evt.params));
      break;
    case "tool.end":
      add("act", evt.toolName);
      add("outcome", evt.success ? "success" : "failure");
      add("cn1", evt.durationMs);
      add("cn1Label", "durationMs");
      if (evt.error) {
        add("reason", evt.error);
      }
      break;
    case "message.in":
      add("suser", evt.from);
      add("deviceCustomString3", evt.channel);
      add("cs3Label", "channel");
      add("fsize", evt.contentLength);
      break;
    case "message.out":
      add("duser", evt.to);
      add("deviceCustomString3", evt.channel);
      add("cs3Label", "channel");
      add("outcome", evt.success ? "success" : "failure");
      if (evt.error) {
        add("reason", evt.error);
      }
      break;
    case "llm.usage":
      add("deviceCustomString3", evt.provider);
      add("cs3Label", "provider");
      add("deviceCustomString4", evt.model);
      add("cs4Label", "model");
      add("cn1", evt.inputTokens);
      add("cn1Label", "inputTokens");
      add("cn2", evt.outputTokens);
      add("cn2Label", "outputTokens");
      add("cn3", evt.cacheTokens);
      add("cn3Label", "cacheTokens");
      add("cfp1", evt.costUsd);
      add("cfp1Label", "costUsd");
      break;
    case "agent.start":
      add("fsize", evt.promptLength);
      break;
    case "agent.end":
      add("outcome", evt.success ? "success" : "failure");
      add("cn1", evt.durationMs);
      add("cn1Label", "durationMs");
      if (evt.error) {
        add("reason", evt.error);
      }
      break;
  }

  return parts.join(" ");
}

function eventSignatureId(type: string): number {
  const ids: Record<string, number> = {
    "tool.start": 1001,
    "tool.end": 1002,
    "message.in": 2001,
    "message.out": 2002,
    "llm.usage": 3001,
    "agent.start": 4001,
    "agent.end": 4002,
  };
  return ids[type] ?? 9999;
}

function eventName(type: string): string {
  const names: Record<string, string> = {
    "tool.start": "Tool Invocation Started",
    "tool.end": "Tool Invocation Completed",
    "message.in": "Message Received",
    "message.out": "Message Sent",
    "llm.usage": "LLM Usage",
    "agent.start": "Agent Started",
    "agent.end": "Agent Completed",
  };
  return names[type] ?? type;
}

function formatCef(evt: SignedEvent, appName: string): string {
  const severity = getSeverity(evt);
  const cefSeverity = severity === SEVERITY_ERROR ? 7 : 3;
  const ext = toCefExtension(evt);
  return `CEF:0|OpenClaw|${appName}|1.0|${eventSignatureId(evt.type)}|${eventName(evt.type)}|${cefSeverity}|${ext}`;
}

function formatSyslogMessage(
  evt: SignedEvent,
  facility: number,
  appName: string,
  format: "cef" | "json",
): string {
  const severity = getSeverity(evt);
  const priority = facility * 8 + severity;
  const timestamp = new Date(evt.ts).toISOString();
  const hostname = "-";
  const msgId = evt.type;
  const structuredData = "-";
  const msg = format === "cef" ? formatCef(evt, appName) : JSON.stringify(evt);

  return `<${priority}>1 ${timestamp} ${hostname} ${appName} - ${msgId} ${structuredData} ${msg}`;
}

export function createSyslogWriter(config: SyslogConfig): SyslogWriter {
  const protocol = config.protocol ?? "udp";
  const port = config.port ?? 514;
  const facility = config.facility ?? FACILITY_LOCAL0;
  const appName = config.appName ?? "openclaw";
  const format = config.format ?? "cef";

  let socket: dgram.Socket | net.Socket | tls.TLSSocket | null = null;
  let connected = false;
  let connecting = false;
  const queue: Buffer[] = [];

  const send = (data: Buffer) => {
    if (protocol === "udp" && socket instanceof dgram.Socket) {
      socket.send(data, port, config.host);
    } else if (socket instanceof net.Socket || socket instanceof tls.TLSSocket) {
      if (connected) {
        socket.write(data);
        socket.write("\n");
      } else {
        queue.push(data);
      }
    }
  };

  const connect = () => {
    if (connecting || connected) {
      return;
    }
    connecting = true;

    if (protocol === "udp") {
      socket = dgram.createSocket("udp4");
      connected = true;
      connecting = false;
    } else if (protocol === "tcp") {
      socket = net.createConnection({ host: config.host, port }, () => {
        connected = true;
        connecting = false;
        for (const msg of queue) {
          send(msg);
        }
        queue.length = 0;
      });
      socket.on("error", () => {
        connected = false;
        connecting = false;
      });
      socket.on("close", () => {
        connected = false;
      });
    } else if (protocol === "tcp-tls") {
      socket = tls.connect({ host: config.host, port }, () => {
        connected = true;
        connecting = false;
        for (const msg of queue) {
          send(msg);
        }
        queue.length = 0;
      });
      socket.on("error", () => {
        connected = false;
        connecting = false;
      });
      socket.on("close", () => {
        connected = false;
      });
    }
  };

  connect();

  return {
    write(evt: SignedEvent) {
      const msg = formatSyslogMessage(evt, facility, appName, format);
      const data = Buffer.from(msg, "utf8");
      send(data);
    },
    async close() {
      return new Promise<void>((resolve) => {
        if (!socket) {
          resolve();
          return;
        }
        if (protocol === "udp" && socket instanceof dgram.Socket) {
          socket.close(() => resolve());
        } else if (socket instanceof net.Socket || socket instanceof tls.TLSSocket) {
          socket.end(() => resolve());
        } else {
          resolve();
        }
      });
    },
  };
}
