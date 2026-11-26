import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogRecord {
  ts: string;
  level: LogLevel;
  event: string;
  op?: string;
  durationMs?: number;
  ok?: boolean;
  errorCode?: string;
  errorMessage?: string;
  meta?: Record<string, string | number | boolean | null>;
}

const MAX_LOG_BYTES = 512 * 1024; // 512 KB cap per log file

/**
 * Redact local user home paths and Windows/Unix usernames so logs are safe
 * to attach to public GitHub issues.
 */
export function sanitizeText(input: string): string {
  const home = os.homedir();
  let out = input;
  if (home) {
    const escaped = home.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(escaped, "gi"), "<HOME>");
    const forwardHome = home.replace(/\\/g, "/");
    const escapedForward = forwardHome.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(escapedForward, "gi"), "<HOME>");
  }
  out = out.replace(/([A-Za-z]:\\Users\\)[^\\/\s"']+/gi, "$1<USER>");
  out = out.replace(/(\/(?:Users|home)\/)[^/\s"']+/g, "$1<USER>");
  return out;
}

export class DiagnosticsLogger {
  public readonly logFile: string;
  private readonly debugStderr: boolean;

  constructor(baseDir: string) {
    this.logFile = path.join(baseDir, "_logs", "agent-handoff.jsonl");
    this.debugStderr =
      process.env.HANDOFF_DEBUG === "1" ||
      process.env.HANDOFF_DEBUG === "true";
  }

  private async rotateIfNeeded(): Promise<void> {
    try {
      const stat = await fs.stat(this.logFile);
      if (stat.size >= MAX_LOG_BYTES) {
        const backup = `${this.logFile}.1`;
        await fs.rm(backup, { force: true });
        await fs.rename(this.logFile, backup);
      }
    } catch {
      // File does not exist yet
    }
  }

  async write(record: Omit<LogRecord, "ts">): Promise<void> {
    const safeRecord: LogRecord = {
      ts: new Date().toISOString(),
      ...record,
      errorMessage: record.errorMessage
        ? sanitizeText(record.errorMessage).slice(0, 400)
        : undefined,
    };

    const line = JSON.stringify(safeRecord);

    // IMPORTANT: Never write to stdout in a stdio MCP server (stdout is JSON-RPC).
    if (this.debugStderr) {
      process.stderr.write(`[agent-handoff] ${line}\n`);
    }

    try {
      await fs.mkdir(path.dirname(this.logFile), { recursive: true });
      await this.rotateIfNeeded();
      await fs.appendFile(this.logFile, `${line}\n`, "utf8");
    } catch {
      // Logging must never break normal MCP operations
    }
  }

  async tail(maxLines = 60): Promise<string[]> {
    try {
      const raw = await fs.readFile(this.logFile, "utf8");
      const lines = raw.trim().split(/\r?\n/).filter(Boolean);
      return lines.slice(-maxLines).map(sanitizeText);
    } catch {
      return [];
    }
  }
}
