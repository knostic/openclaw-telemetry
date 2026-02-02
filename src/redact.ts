import type { RedactConfig } from "./types.js";

const DEFAULT_PATTERNS = [
  "(?i)(api[_-]?key|apikey)[\"']?\\s*[:=]\\s*[\"']?[a-z0-9_-]{16,}",
  "(?i)(password|passwd|pwd)[\"']?\\s*[:=]\\s*[\"'][^\"']+[\"']",
  "(?i)(secret|token|auth)[\"']?\\s*[:=]\\s*[\"']?[a-z0-9_-]{16,}",
  "(?i)bearer\\s+[a-z0-9_-]{20,}",
  "(?i)(aws_secret|aws_access)[a-z_]*[\"']?\\s*[:=]\\s*[\"']?[a-z0-9/+=]{20,}",
  "sk-[a-zA-Z0-9]{32,}",
  "ghp_[a-zA-Z0-9]{36}",
  "gho_[a-zA-Z0-9]{36}",
  "glpat-[a-zA-Z0-9_-]{20,}",
  "xox[baprs]-[a-zA-Z0-9-]{10,}",
];

const DEFAULT_REPLACEMENT = "[REDACTED]";

function compilePatterns(patterns: string[]): RegExp[] {
  return patterns.map((p) => {
    const flags = p.startsWith("(?i)") ? "gi" : "g";
    const pattern = p.replace(/^\(\?i\)/, "");
    return new RegExp(pattern, flags);
  });
}

export function createRedactor(config: RedactConfig = {}) {
  if (!config.enabled) {
    return { redact: <T>(v: T): T => v };
  }

  const patterns = compilePatterns(config.patterns ?? DEFAULT_PATTERNS);
  const replacement = config.replacement ?? DEFAULT_REPLACEMENT;

  function redactString(s: string): string {
    let result = s;
    for (const p of patterns) {
      result = result.replace(p, replacement);
    }
    return result;
  }

  function redactValue(v: unknown): unknown {
    if (typeof v === "string") {
      return redactString(v);
    }
    if (Array.isArray(v)) {
      return v.map(redactValue);
    }
    if (v !== null && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v)) {
        out[k] = redactValue(val);
      }
      return out;
    }
    return v;
  }

  return {
    redact: <T>(v: T): T => redactValue(v) as T,
  };
}
