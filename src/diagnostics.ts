import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { DiagnosticsLogger, sanitizeText } from "./logger.js";
import { LocalMarkdownStore } from "./store.js";

export const REPO_SLUG = "648428732qq-sketch/agent-handoff-mcp";
export const PACKAGE_VERSION: string = createRequire(import.meta.url)(
  "../../package.json"
).version;

export interface DiagnosticSummary {
  version: string;
  nodeVersion: string;
  platform: string;
  arch: string;
  handoffDir: string;
  handoffDirWritable: boolean;
  activeSlotCount: number;
  logFile: string;
  recentLogs: string[];
  issueUrl: string;
}

export async function collectDiagnostics(
  handoffDir?: string,
  maxLogLines = 50
): Promise<DiagnosticSummary> {
  const store = new LocalMarkdownStore(handoffDir);
  const logger = new DiagnosticsLogger(store.baseDir);

  let writable = false;
  try {
    await fs.mkdir(store.baseDir, { recursive: true });
    const probe = path.join(store.baseDir, `.probe.${process.pid}.tmp`);
    await fs.writeFile(probe, "ok", "utf8");
    await fs.unlink(probe);
    writable = true;
  } catch {
    writable = false;
  }

  let activeSlotCount = 0;
  try {
    activeSlotCount = (await store.list()).length;
  } catch {
    activeSlotCount = -1;
  }

  const recentLogs = await logger.tail(maxLogLines);
  const issueUrl = `https://github.com/${REPO_SLUG}/issues/new?template=bug_report.yml`;

  return {
    version: PACKAGE_VERSION,
    nodeVersion: process.version,
    platform: `${os.platform()} ${os.release()}`,
    arch: os.arch(),
    handoffDir: sanitizeText(store.baseDir),
    handoffDirWritable: writable,
    activeSlotCount,
    logFile: sanitizeText(logger.logFile),
    recentLogs,
    issueUrl,
  };
}

export function formatBugReportMarkdown(diag: DiagnosticSummary): string {
  const logsBlock =
    diag.recentLogs.length > 0
      ? diag.recentLogs.join("\n")
      : "(no logs recorded yet — reproduce the issue with HANDOFF_DEBUG=1 if needed)";

  return [
    "### Environment & Diagnostics (Sanitized — No Conversation Content)",
    `- **agent-handoff-mcp**: v${diag.version}`,
    `- **Node.js**: ${diag.nodeVersion}`,
    `- **OS**: ${diag.platform} (${diag.arch})`,
    `- **HANDOFF_DIR**: \`${diag.handoffDir}\` (writable: ${diag.handoffDirWritable})`,
    `- **Active slots**: ${diag.activeSlotCount}`,
    `- **Log file**: \`${diag.logFile}\``,
    "",
    "<details>",
    "<summary>Recent sanitized JSONL logs</summary>",
    "",
    "```jsonl",
    logsBlock,
    "```",
    "</details>",
    "",
    `Submit bug report here: ${diag.issueUrl}`,
  ].join("\n");
}
