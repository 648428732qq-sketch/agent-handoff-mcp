import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { resolveHandoffDir } from "./store.js";

export type TargetClient =
  | "antigravity"
  | "codex"
  | "claude"
  | "cursor"
  | "trae"
  | "workbuddy"
  | "all";

interface McpServerEntry {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

function buildMcpEntry(handoffDir?: string): McpServerEntry {
  const entry: McpServerEntry = {
    command: "npx",
    args: ["-y", "agent-handoff-mcp"],
  };
  if (handoffDir && handoffDir.trim()) {
    entry.env = { HANDOFF_DIR: resolveHandoffDir(handoffDir) };
  }
  return entry;
}

async function mergeJsonMcpConfig(
  configPath: string,
  serverKey: string,
  entry: McpServerEntry
): Promise<void> {
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  let data: Record<string, unknown> = {};

  try {
    const existing = await fs.readFile(configPath, "utf8");
    if (existing.trim()) {
      await fs.writeFile(`${configPath}.bak`, existing, "utf8");
      data = JSON.parse(existing) as Record<string, unknown>;
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      throw new Error(`Failed to parse existing JSON at ${configPath}: ${err}`);
    }
  }

  const servers =
    (data.mcpServers as Record<string, unknown> | undefined) ?? {};
  servers[serverKey] = entry;
  data.mcpServers = servers;

  await fs.writeFile(configPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

async function appendCodexTomlConfig(
  configPath: string,
  entry: McpServerEntry
): Promise<"added" | "exists"> {
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  let existing = "";
  try {
    existing = await fs.readFile(configPath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }

  if (/\[mcp_servers\.agent-handoff\]/.test(existing)) {
    return "exists";
  }

  if (existing.trim()) {
    await fs.writeFile(`${configPath}.bak`, existing, "utf8");
  }

  const envBlock = entry.env?.HANDOFF_DIR
    ? `\n[mcp_servers.agent-handoff.env]\nHANDOFF_DIR = ${JSON.stringify(entry.env.HANDOFF_DIR)}\n`
    : "";

  const snippet = `\n[mcp_servers.agent-handoff]\ncommand = ${JSON.stringify(
    entry.command
  )}\nargs = ${JSON.stringify(entry.args)}${envBlock}\n`;

  await fs.writeFile(configPath, existing.trimEnd() + "\n" + snippet, "utf8");
  return "added";
}

export async function runInit(options: {
  target?: string;
  dir?: string;
}): Promise<void> {
  const target = (options.target || "all").toLowerCase() as TargetClient;
  const handoffDir = options.dir ? resolveHandoffDir(options.dir) : undefined;
  const entry = buildMcpEntry(handoffDir);
  const home = os.homedir();

  const should = (name: Exclude<TargetClient, "all">) =>
    target === "all" || target === name;

  console.log("agent-handoff-mcp setup\n");
  console.log(
    `Handoff directory: ${handoffDir ?? path.join(home, ".agent-handoff")} (override via HANDOFF_DIR)\n`
  );

  if (should("antigravity")) {
    const p = path.join(home, ".gemini", "antigravity", "mcp_config.json");
    try {
      await mergeJsonMcpConfig(p, "agent-handoff", entry);
      console.log(`[OK] Antigravity MCP config updated: ${p}`);
    } catch (e) {
      console.log(`[WARN] Antigravity skipped: ${(e as Error).message}`);
    }
  }

  if (should("codex")) {
    const p = path.join(home, ".codex", "config.toml");
    try {
      const status = await appendCodexTomlConfig(p, entry);
      console.log(
        status === "added"
          ? `[OK] Codex MCP config updated: ${p}`
          : `[SKIP] Codex already has [mcp_servers.agent-handoff]: ${p}`
      );
    } catch (e) {
      console.log(`[WARN] Codex skipped: ${(e as Error).message}`);
    }
  }

  if (should("claude")) {
    const p = path.join(home, ".claude.json");
    try {
      await mergeJsonMcpConfig(p, "agent-handoff", entry);
      console.log(`[OK] Claude Code MCP config updated: ${p}`);
    } catch (e) {
      console.log(`[WARN] Claude Code skipped: ${(e as Error).message}`);
    }
  }

  if (should("cursor")) {
    const p = path.join(home, ".cursor", "mcp.json");
    try {
      await mergeJsonMcpConfig(p, "agent-handoff", entry);
      console.log(`[OK] Cursor MCP config updated: ${p}`);
    } catch (e) {
      console.log(`[WARN] Cursor skipped: ${(e as Error).message}`);
    }
  }

  if (should("trae") || should("workbuddy")) {
    console.log("\n--- Manual UI Config (Trae / WorkBuddy / Other MCP Clients) ---");
    console.log(
      "Paste this JSON block into Trae (Settings -> MCP -> Add Manually) or WorkBuddy MCP Settings:\n"
    );
    console.log(
      JSON.stringify(
        {
          mcpServers: {
            "agent-handoff": entry,
          },
        },
        null,
        2
      )
    );
  }

  console.log("\nDone! Restart or open a new session in your AI agent to use:");
  console.log('  - Save:   "交接 <topic>"  (or /agent-handoff:save in WorkBuddy)');
  console.log('  - Resume: "继续 <topic>"  (or /agent-handoff:resume in WorkBuddy)');
  console.log('  - List:   "看交接"');
  console.log('  - Close:  "结束交接 <topic>"');
}
