import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { parse as parseToml } from "smol-toml";

const automaticTargets = ["antigravity", "codex", "claude", "cursor"] as const;
type AutomaticTarget = (typeof automaticTargets)[number];
export type TargetClient = AutomaticTarget | "trae" | "workbuddy" | "all" | "auto";
interface McpServerEntry { command: string; args: string[]; env: { HANDOFF_DIR: string } }
interface PlannedWrite { filePath: string; content: string; previous: string | null }
export interface InitOptions {
  target?: string;
  dir?: string;
  force?: boolean;
  /** Internal injection for isolated tests, not a command-line option. */
  homeDir?: string;
}
const beginMarker = "# BEGIN agent-handoff-mcp";
const endMarker = "# END agent-handoff-mcp";

async function exists(filePath: string): Promise<boolean> {
  try { await fs.stat(filePath); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
}
async function readExisting(filePath: string): Promise<string | null> {
  try { return await fs.readFile(filePath, "utf8"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function sameText(left: string, right: string): boolean {
  return left.replace(/\r\n/g, "\n") === right.replace(/\r\n/g, "\n");
}
function resolvedDir(value: string, home: string): string {
  return path.resolve(value.replace(/^~(?=$|[\\/])/, home));
}
function sameDir(left: string, right: string): boolean {
  return process.platform === "win32" ? left.toLowerCase() === right.toLowerCase() : left === right;
}
function compatibleService(current: unknown, entry: McpServerEntry, home: string): current is Record<string, unknown> {
  if (!isRecord(current) || current.command !== entry.command) return false;
  const argsMatch = isDeepStrictEqual(current.args, entry.args)
    || (Array.isArray(current.args) && current.args.length === 2 && current.args[0] === "-y" && current.args[1] === "agent-handoff-mcp@latest");
  if (!argsMatch) return false;
  if (current.env !== undefined && !isRecord(current.env)) return false;
  const env = (current.env ?? {}) as Record<string, unknown>;
  if (env.HANDOFF_DIR !== undefined && typeof env.HANDOFF_DIR !== "string") return false;
  const currentDir = typeof env.HANDOFF_DIR === "string" && env.HANDOFF_DIR.trim()
    ? resolvedDir(env.HANDOFF_DIR, home) : path.join(home, ".agent-handoff");
  return sameDir(currentDir, entry.env.HANDOFF_DIR);
}

async function planJsonConfig(filePath: string, entry: McpServerEntry, force: boolean, home: string): Promise<PlannedWrite> {
  const previous = await readExisting(filePath);
  let data: unknown = {};
  if (previous?.trim()) {
    try { data = JSON.parse(previous); }
    catch { throw new Error(`Invalid JSON in ${filePath}. The original file was not changed; fix it before running init again.`); }
  }
  if (!isRecord(data) || (data.mcpServers !== undefined && !isRecord(data.mcpServers))) {
    throw new Error(`Invalid MCP configuration object in ${filePath}. The original file was not changed.`);
  }
  const servers = (data.mcpServers ?? {}) as Record<string, unknown>;
  const current = servers["agent-handoff"];
  let replacement: unknown = entry;
  if (compatibleService(current, entry, home)) {
    replacement = { ...current, env: { ...(current.env as Record<string, unknown> | undefined), HANDOFF_DIR: entry.env.HANDOFF_DIR } };
  } else if (current !== undefined && !force) {
    throw new Error(`Conflicting agent-handoff service in ${filePath}; kept unchanged. Use --force to back up and replace this service, or keep your existing configuration.`);
  }
  if (current !== undefined && isDeepStrictEqual(current, replacement)) return { filePath, content: previous!, previous };
  data.mcpServers = { ...servers, "agent-handoff": replacement };
  return { filePath, content: `${JSON.stringify(data, null, 2)}\n`, previous };
}

function codexBlock(entry: McpServerEntry): string {
  return `${beginMarker}\n[mcp_servers.agent-handoff]\ncommand = ${JSON.stringify(entry.command)}\nargs = ${JSON.stringify(entry.args)}\n\n[mcp_servers.agent-handoff.env]\nHANDOFF_DIR = ${JSON.stringify(entry.env.HANDOFF_DIR)}\n${endMarker}`;
}
function readToml(text: string, filePath: string): Record<string, unknown> {
  try { return parseToml(text); }
  catch { throw new Error(`Invalid TOML in ${filePath}. The original file was not changed; fix it before running init again.`); }
}
function otherCodexSettings(data: Record<string, unknown>): Record<string, unknown> {
  const result = { ...data };
  if (isRecord(result.mcp_servers)) {
    const servers = { ...result.mcp_servers };
    delete servers["agent-handoff"];
    if (Object.keys(servers).length) result.mcp_servers = servers;
    else delete result.mcp_servers;
  }
  return result;
}
async function planCodexConfig(filePath: string, entry: McpServerEntry, force: boolean, home: string): Promise<PlannedWrite> {
  const previous = await readExisting(filePath);
  const text = previous ?? "";
  const parsed = readToml(text, filePath);
  if (parsed.mcp_servers !== undefined && !isRecord(parsed.mcp_servers)) throw new Error(`Unsupported mcp_servers structure in ${filePath}; kept unchanged.`);
  const current = (parsed.mcp_servers as Record<string, unknown> | undefined)?.["agent-handoff"];
  const replacement = codexBlock(entry);
  const starts = text.split(beginMarker).length - 1;
  const ends = text.split(endMarker).length - 1;
  if (starts || ends) {
    const start = text.indexOf(beginMarker);
    const end = text.indexOf(endMarker) + endMarker.length;
    if (starts !== 1 || ends !== 1 || end <= start) throw new Error(`Ambiguous agent-handoff managed markers in ${filePath}; kept unchanged. Resolve the existing block manually.`);
    const before = text.slice(0, start), after = text.slice(end);
    if (compatibleService(current, entry, home)) return { filePath, content: text, previous };
    if (!force) throw new Error(`Conflicting agent-handoff service or HANDOFF_DIR in ${filePath}; kept unchanged. Use --force to back up and replace the managed block.`);
    const content = before + replacement + after;
    const updated = readToml(content, filePath);
    const updatedService = (updated.mcp_servers as Record<string, unknown> | undefined)?.["agent-handoff"];
    if (!compatibleService(updatedService, entry, home)) throw new Error(`Managed markers do not identify an active agent-handoff service in ${filePath}; kept unchanged. Resolve the block manually.`);
    if (!isDeepStrictEqual(otherCodexSettings(parsed), otherCodexSettings(updated))) throw new Error(`Managed markers contain unrelated TOML settings in ${filePath}; kept unchanged. Resolve the block manually.`);
    return { filePath, content, previous };
  }
  if (current !== undefined) {
    if (compatibleService(current, entry, home)) return { filePath, content: text, previous };
    throw new Error(`Existing custom agent-handoff TOML in ${filePath}; kept unchanged. Edit or remove that service manually. --force only replaces blocks managed by this installer.`);
  }
  const content = `${text}${text && !text.endsWith("\n") ? "\n" : ""}\n${replacement}\n`;
  readToml(content, filePath);
  return { filePath, content, previous };
}

async function planSkill(filePath: string, content: string, force: boolean): Promise<PlannedWrite> {
  const previous = await readExisting(filePath);
  if (previous !== null && sameText(previous, content)) return { filePath, content: previous, previous };
  if (previous !== null && !force) throw new Error(`Custom Skill already exists at ${filePath}; kept unchanged. Use --force to back up and replace it, or keep your existing rules.`);
  return { filePath, content, previous };
}
async function writePlan(plan: PlannedWrite): Promise<void> {
  if (plan.previous !== null && plan.content === plan.previous) { console.log(`[OK] Already configured: ${plan.filePath}`); return; }
  await fs.mkdir(path.dirname(plan.filePath), { recursive: true });
  if (plan.previous !== null) {
    const backup = `${plan.filePath}.bak-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID()}`;
    await fs.writeFile(backup, plan.previous, { encoding: "utf8", flag: "wx", mode: 0o600 });
    console.log(`[BACKUP] ${backup}`);
  }
  const temporary = `${plan.filePath}.tmp-${randomUUID()}`;
  try {
    await fs.writeFile(temporary, plan.content, { encoding: "utf8", flag: "wx", mode: 0o600 });
    await fs.rename(temporary, plan.filePath);
  } finally { await fs.unlink(temporary).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; }); }
  console.log(`[OK] Installed: ${plan.filePath}`);
}
async function verifyDataDirectory(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  const probe = path.join(dir, `.agent-handoff-write-check-${randomUUID()}`);
  try { await fs.writeFile(probe, "", { flag: "wx", mode: 0o600 }); }
  finally { await fs.unlink(probe).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; }); }
}
async function detectedTargets(home: string): Promise<AutomaticTarget[]> {
  const candidates: [AutomaticTarget, string[]][] = [
    ["antigravity", [path.join(home, ".gemini", "config"), path.join(home, ".gemini", "antigravity")]],
    ["codex", [path.join(home, ".codex")]],
    ["claude", [path.join(home, ".claude"), path.join(home, ".claude.json")]],
    ["cursor", [path.join(home, ".cursor")]],
  ];
  const found: AutomaticTarget[] = [];
  for (const [target, paths] of candidates) for (const candidate of paths) if (await exists(candidate)) { found.push(target); break; }
  return found;
}

export async function runInit(options: InitOptions = {}): Promise<void> {
  const target = (options.target ?? "auto").toLowerCase();
  if (![...automaticTargets, "auto", "all", "trae", "workbuddy"].includes(target)) throw new Error(`Unknown target "${target}". Choose auto, codex, antigravity, claude, cursor, trae, workbuddy, or all.`);
  const home = path.resolve(options.homeDir ?? os.homedir());
  const selected = target === "auto" ? await detectedTargets(home) : target === "all" ? [...automaticTargets] : automaticTargets.includes(target as AutomaticTarget) ? [target as AutomaticTarget] : [];
  if (target === "auto" && selected.length === 0) throw new Error("No supported AI client was detected. Open your client once, then retry; or run npx -y agent-handoff-mcp init --target codex (other targets: antigravity, claude, cursor, trae, workbuddy). No client configuration was created.");
  const chosenDir = options.dir?.trim() || process.env.HANDOFF_DIR?.trim() || path.join(home, ".agent-handoff");
  const handoffDir = resolvedDir(chosenDir, home);
  const entry: McpServerEntry = { command: "npx", args: ["-y", "agent-handoff-mcp"], env: { HANDOFF_DIR: handoffDir } };
  const plans: PlannedWrite[] = [], force = options.force ?? false;
  const skillContent = selected.length ? await fs.readFile(new URL("../../SKILL.md", import.meta.url), "utf8") : "";
  for (const client of selected) {
    let configPath: string, skillRoot: string;
    if (client === "antigravity") {
      const current = path.join(home, ".gemini", "config", "mcp_config.json"), legacy = path.join(home, ".gemini", "antigravity", "mcp_config.json");
      const useLegacy = !(await exists(current)) && await exists(legacy);
      configPath = useLegacy ? legacy : current;
      skillRoot = path.join(home, ".gemini", useLegacy ? "antigravity" : "config", "skills");
    } else if (client === "codex") {
      configPath = path.join(home, ".codex", "config.toml"); skillRoot = path.join(home, ".agents", "skills");
    } else if (client === "claude") {
      configPath = path.join(home, ".claude.json"); skillRoot = path.join(home, ".claude", "skills");
    } else {
      configPath = path.join(home, ".cursor", "mcp.json"); skillRoot = path.join(home, ".cursor", "skills");
    }
    plans.push(client === "codex" ? await planCodexConfig(configPath, entry, force, home) : await planJsonConfig(configPath, entry, force, home));
    plans.push(await planSkill(path.join(skillRoot, "agent-handoff", "SKILL.md"), skillContent, force));
  }
  // Resolve every selected client's conflicts before changing any configuration.
  await verifyDataDirectory(handoffDir);
  console.log(`agent-handoff-mcp setup\nHandoff directory: ${handoffDir}`);
  for (const plan of plans) await writePlan(plan);
  if (selected.length) {
    console.log(`\nConfigured MCP + Skill for: ${selected.join(", ")}. Restart these clients or open a new session.`);
    console.log('Then say: "交接 <topic>", "继续 <topic>", "看交接", or "结束交接 <topic>".');
  }
  if (["trae", "workbuddy", "all"].includes(target)) {
    console.log("\nManual setup required for Trae / WorkBuddy: paste this configuration into the client's MCP settings.");
    console.log(JSON.stringify({ mcpServers: { "agent-handoff": entry } }, null, 2));
    console.log("Also install the bundled SKILL.md using your client's rules/skills feature, or provide its handoff protocol as instructions. No Skill was automatically installed for these clients.");
    console.log(`Skill source: ${new URL("../../SKILL.md", import.meta.url).href}`);
  }
}
