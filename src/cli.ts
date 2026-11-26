#!/usr/bin/env node
import {
  collectDiagnostics,
  formatBugReportMarkdown,
  PACKAGE_VERSION,
} from "./diagnostics.js";
import { runInit } from "./init.js";
import { runStdioServer } from "./server.js";
import { LocalMarkdownStore } from "./store.js";

function printHelp(): void {
  console.log(`agent-handoff-mcp v${PACKAGE_VERSION}
Cross-agent isolated conversation handoff MCP server & CLI.

Usage:
  agent-handoff-mcp                      Start local stdio MCP server (default)
  agent-handoff-mcp serve [--dir PATH]   Start local stdio MCP server
  agent-handoff-mcp init [--target NAME] [--dir PATH]
                                         Register MCP config for Antigravity, Codex,
                                         Claude Code, Cursor, Trae, and WorkBuddy
  agent-handoff-mcp list [--project P]   List active isolated handoff slots
  agent-handoff-mcp load <topic>         Print a handoff slot's Markdown content
  agent-handoff-mcp export <topic>       Print a copy-paste prompt for Web AI tools
  agent-handoff-mcp close <topic> [--archive DIR]
                                         Remove a finished slot (optionally archive)
  agent-handoff-mcp doctor [--dir PATH]  Check environment health and log location
  agent-handoff-mcp report [--lines N]   Generate a sanitized Markdown bug report
                                         and GitHub Issue link (no private content)

Environment:
  HANDOFF_DIR    Custom directory for handoff Markdown files (default: ~/.agent-handoff)
  HANDOFF_DEBUG  Set to 1 to mirror JSONL diagnostics to stderr
`);
}

function getFlag(args: string[], name: string): string | undefined {
  const idx = args.indexOf(name);
  if (idx !== -1 && idx + 1 < args.length) {
    return args[idx + 1];
  }
  return undefined;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const cmd = args[0];

  if (!cmd || cmd === "serve") {
    const dir = getFlag(args, "--dir");
    await runStdioServer(dir);
    return;
  }

  if (cmd === "-h" || cmd === "--help" || cmd === "help") {
    printHelp();
    return;
  }

  if (cmd === "-v" || cmd === "--version") {
    console.log(PACKAGE_VERSION);
    return;
  }

  if (cmd === "init") {
    await runInit({
      target: getFlag(args, "--target"),
      dir: getFlag(args, "--dir"),
    });
    return;
  }

  if (cmd === "doctor" || cmd === "report") {
    const dir = getFlag(args, "--dir");
    const lines = Number(getFlag(args, "--lines") || "50");
    const diag = await collectDiagnostics(
      dir,
      Number.isFinite(lines) && lines > 0 ? lines : 50
    );
    if (cmd === "doctor") {
      console.log(`agent-handoff-mcp v${diag.version} — Health Check`);
      console.log(`  Node.js:      ${diag.nodeVersion}`);
      console.log(`  OS:           ${diag.platform} (${diag.arch})`);
      console.log(
        `  HANDOFF_DIR:  ${diag.handoffDir} (${diag.handoffDirWritable ? "OK, writable" : "ERROR, not writable"})`
      );
      console.log(`  Active slots: ${diag.activeSlotCount}`);
      console.log(`  Log file:     ${diag.logFile}`);
      console.log(`  Report bugs:  npx -y agent-handoff-mcp report`);
      if (!diag.handoffDirWritable) process.exit(1);
      return;
    }
    console.log(formatBugReportMarkdown(diag));
    return;
  }

  const store = new LocalMarkdownStore(getFlag(args, "--dir"));

  if (cmd === "list") {
    const project = getFlag(args, "--project");
    const entries = await store.list(project);
    if (entries.length === 0) {
      console.log("No active handoff slots.");
      return;
    }
    for (const [i, e] of entries.entries()) {
      console.log(
        `${i + 1}. ${e.topic}  [${e.project ?? "-"}]  (${e.sourceAgent}, ${e.updated})\n   ${e.summary}`
      );
    }
    return;
  }

  if (cmd === "load") {
    const topic = args[1];
    if (!topic) {
      console.error("Usage: agent-handoff-mcp load <topic>");
      process.exit(1);
    }
    const loaded = await store.load(topic);
    if (!loaded) {
      console.error(`Handoff slot not found: ${topic}`);
      process.exit(1);
    }
    console.log(loaded.content);
    return;
  }

  if (cmd === "export") {
    const topic = args[1];
    if (!topic) {
      console.error("Usage: agent-handoff-mcp export <topic>");
      process.exit(1);
    }
    const prompt = await store.exportPrompt(topic);
    if (!prompt) {
      console.error(`Handoff slot not found: ${topic}`);
      process.exit(1);
    }
    console.log(prompt);
    return;
  }

  if (cmd === "close") {
    const topic = args[1];
    if (!topic) {
      console.error("Usage: agent-handoff-mcp close <topic> [--archive DIR]");
      process.exit(1);
    }
    const archiveDir = getFlag(args, "--archive");
    const result = await store.close(topic, archiveDir);
    if (!result) {
      console.error(`Handoff slot not found: ${topic}`);
      process.exit(1);
    }
    console.log(`Closed "${result.topic}" (${result.removedFile})`);
    if (result.archivedFile) {
      console.log(`Archived to: ${result.archivedFile}`);
    }
    return;
  }

  console.error(`Unknown command: ${cmd}`);
  printHelp();
  process.exit(1);
}

main().catch((err) => {
  console.error(`[agent-handoff-mcp] ${(err as Error).message}`);
  process.exit(1);
});
