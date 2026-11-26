import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test, { type TestContext } from "node:test";
import { parse as parseToml } from "smol-toml";
import { runInit } from "../src/init.js";

async function sandbox(t: TestContext): Promise<string> {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "handoff-init-test-"));
  const originalDir = process.env.HANDOFF_DIR;
  delete process.env.HANDOFF_DIR;
  t.mock.method(console, "log", () => {});
  t.after(async () => {
    if (originalDir === undefined) delete process.env.HANDOFF_DIR;
    else process.env.HANDOFF_DIR = originalDir;
    const resolved = path.resolve(home);
    assert.ok(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep));
    await fs.rm(resolved, { recursive: true, force: true });
  });
  return home;
}
async function write(file: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content, { mode: 0o600 });
}
async function json(file: string): Promise<any> { return JSON.parse(await fs.readFile(file, "utf8")); }
async function backups(file: string): Promise<string[]> {
  return (await fs.readdir(path.dirname(file))).filter((name) => name.startsWith(path.basename(file) + ".bak-"));
}

test("init rejects invalid targets and empty auto detection without writing files", async (t) => {
  const home = await sandbox(t);
  await assert.rejects(runInit({ target: "typo", homeDir: home }), /Unknown target/);
  await assert.rejects(runInit({ homeDir: home }), /No supported AI client.*--target codex/);
  assert.deepEqual(await fs.readdir(home), []);
});

test("auto installs MCP and Skill only for detected clients and preserves other settings", async (t) => {
  const home = await sandbox(t);
  await write(path.join(home, ".codex", "config.toml"), 'model = "example"\n');
  await write(path.join(home, ".claude.json"), JSON.stringify({ preference: true, mcpServers: { other: { command: "other" } } }));
  await fs.mkdir(path.join(home, ".gemini", "config"), { recursive: true });
  await runInit({ homeDir: home });
  const dir = path.join(home, ".agent-handoff");
  const claude = await json(path.join(home, ".claude.json"));
  assert.equal(claude.preference, true);
  assert.equal(claude.mcpServers.other.command, "other");
  assert.equal(claude.mcpServers["agent-handoff"].env.HANDOFF_DIR, dir);
  const codex = parseToml(await fs.readFile(path.join(home, ".codex", "config.toml"), "utf8")) as any;
  assert.equal(codex.model, "example");
  assert.equal(codex.mcp_servers["agent-handoff"].env.HANDOFF_DIR, dir);
  const antigravity = await json(path.join(home, ".gemini", "config", "mcp_config.json"));
  assert.equal(antigravity.mcpServers["agent-handoff"].env.HANDOFF_DIR, dir);
  for (const skill of [".agents/skills", ".claude/skills", ".gemini/config/skills"]) {
    assert.match(await fs.readFile(path.join(home, skill, "agent-handoff", "SKILL.md"), "utf8"), /name: agent-handoff/);
  }
  assert.equal(await fs.stat(path.join(home, ".cursor")).catch(() => null), null);
  assert.deepEqual(await fs.readdir(dir), []);
});

test("repeated init does not rewrite configuration, Skill, or backups", async (t) => {
  const home = await sandbox(t);
  await runInit({ target: "cursor", homeDir: home });
  const config = path.join(home, ".cursor", "mcp.json");
  const skill = path.join(home, ".cursor", "skills", "agent-handoff", "SKILL.md");
  const configBefore = await fs.stat(config, { bigint: true });
  const skillBefore = await fs.stat(skill, { bigint: true });
  await runInit({ homeDir: home });
  assert.equal((await fs.stat(config, { bigint: true })).mtimeNs, configBefore.mtimeNs);
  assert.equal((await fs.stat(skill, { bigint: true })).mtimeNs, skillBefore.mtimeNs);
  assert.deepEqual(await backups(config), []);
  assert.deepEqual(await backups(skill), []);
});

test("malformed JSON is preserved even with force and preflight does not install Skill", async (t) => {
  const home = await sandbox(t), config = path.join(home, ".cursor", "mcp.json");
  const invalid = '{"mcpServers": { broken';
  await write(config, invalid);
  await assert.rejects(runInit({ target: "cursor", homeDir: home, force: true }), /Invalid JSON/);
  assert.equal(await fs.readFile(config, "utf8"), invalid);
  assert.deepEqual(await fs.readdir(path.dirname(config)), ["mcp.json"]);
  assert.equal(await fs.stat(path.join(home, ".agent-handoff")).catch(() => null), null);
});

test("custom service is protected; force creates unique private recoverable backups", async (t) => {
  const home = await sandbox(t), config = path.join(home, ".cursor", "mcp.json");
  const original = JSON.stringify({ settings: true, mcpServers: { other: { command: "keep" }, "agent-handoff": { command: "custom" } } });
  await write(config, original);
  await write(config + ".bak", "old backup");
  await assert.rejects(runInit({ target: "cursor", homeDir: home }), /Conflicting agent-handoff/);
  assert.equal(await fs.readFile(config, "utf8"), original);
  await runInit({ target: "cursor", homeDir: home, force: true });
  const firstBackups = await backups(config);
  assert.equal(firstBackups.length, 1);
  const backupPath = path.join(path.dirname(config), firstBackups[0]);
  assert.equal(await fs.readFile(backupPath, "utf8"), original);
  assert.equal(await fs.readFile(config + ".bak", "utf8"), "old backup");
  if (process.platform !== "win32") assert.equal((await fs.stat(backupPath)).mode & 0o777, 0o600);
  const updated = await json(config);
  assert.equal(updated.settings, true);
  assert.equal(updated.mcpServers.other.command, "keep");
  await runInit({ target: "cursor", homeDir: home, dir: path.join(home, "other-data"), force: true });
  assert.equal((await backups(config)).length, 2);
  assert.equal(await fs.readFile(backupPath, "utf8"), original);
});

test("custom Skill conflicts are preflighted before MCP writes; force backs it up", async (t) => {
  const home = await sandbox(t), skill = path.join(home, ".agents", "skills", "agent-handoff", "SKILL.md");
  await write(skill, "my custom handoff rules");
  await assert.rejects(runInit({ target: "codex", homeDir: home }), /Custom Skill/);
  assert.equal(await fs.stat(path.join(home, ".codex")).catch(() => null), null);
  await runInit({ target: "codex", homeDir: home, force: true });
  const saved = await backups(skill);
  assert.equal(saved.length, 1);
  assert.equal(await fs.readFile(path.join(path.dirname(skill), saved[0]), "utf8"), "my custom handoff rules");
  assert.match(await fs.readFile(skill, "utf8"), /name: agent-handoff/);
});

test("directory precedence is explicit option, environment, then home default", async (t) => {
  const home = await sandbox(t), fromEnv = path.join(home, "environment-data");
  process.env.HANDOFF_DIR = fromEnv;
  await runInit({ target: "cursor", homeDir: home });
  assert.equal((await json(path.join(home, ".cursor", "mcp.json"))).mcpServers["agent-handoff"].env.HANDOFF_DIR, fromEnv);
  await runInit({ target: "claude", homeDir: home, dir: "~/explicit-data" });
  assert.equal((await json(path.join(home, ".claude.json"))).mcpServers["agent-handoff"].env.HANDOFF_DIR, path.join(home, "explicit-data"));
  delete process.env.HANDOFF_DIR;
  await runInit({ target: "codex", homeDir: home });
  const codex = parseToml(await fs.readFile(path.join(home, ".codex", "config.toml"), "utf8")) as any;
  assert.equal(codex.mcp_servers["agent-handoff"].env.HANDOFF_DIR, path.join(home, ".agent-handoff"));
});

test("old default-directory configurations and latest alias upgrade without force", async (t) => {
  const home = await sandbox(t);
  const config = path.join(home, ".cursor", "mcp.json");
  await write(config, JSON.stringify({ mcpServers: { "agent-handoff": { command: "npx", args: ["-y", "agent-handoff-mcp@latest"], env: { EXTRA: "keep" } } } }));
  const oldCodex = '[mcp_servers.agent-handoff]\ncommand = "npx"\nargs = ["-y", "agent-handoff-mcp"]\n';
  await write(path.join(home, ".codex", "config.toml"), oldCodex);
  await runInit({ homeDir: home });
  const entry = (await json(config)).mcpServers["agent-handoff"];
  assert.equal(entry.env.EXTRA, "keep");
  assert.equal(entry.env.HANDOFF_DIR, path.join(home, ".agent-handoff"));
  assert.equal(entry.args[1], "agent-handoff-mcp@latest");
  assert.equal(await fs.readFile(path.join(home, ".codex", "config.toml"), "utf8"), oldCodex);
});

test("Antigravity legacy fallback keeps matching legacy config and Skill locations", async (t) => {
  const home = await sandbox(t), legacy = path.join(home, ".gemini", "antigravity", "mcp_config.json");
  await write(legacy, "{}");
  await runInit({ homeDir: home });
  assert.ok((await json(legacy)).mcpServers["agent-handoff"]);
  assert.match(await fs.readFile(path.join(home, ".gemini", "antigravity", "skills", "agent-handoff", "SKILL.md"), "utf8"), /name: agent-handoff/);
  assert.equal(await fs.stat(path.join(home, ".gemini", "config")).catch(() => null), null);
});

test("Codex rejects malformed and unsupported existing TOML without modifying it", async (t) => {
  const home = await sandbox(t), config = path.join(home, ".codex", "config.toml");
  for (const original of ['model = "unterminated', 'mcp_servers = { agent-handoff = {command="custom"} }\n', '[[mcp_servers.agent-handoff]]\ncommand="custom"\n']) {
    await write(config, original);
    await assert.rejects(runInit({ target: "codex", homeDir: home, force: true }), /Invalid TOML|Existing custom/);
    assert.equal(await fs.readFile(config, "utf8"), original);
  }
  assert.deepEqual(await backups(config), []);
});

test("Codex force updates only its managed block and preserves surrounding settings", async (t) => {
  const home = await sandbox(t), config = path.join(home, ".codex", "config.toml");
  await write(config, 'model = "keep"\n');
  await runInit({ target: "codex", homeDir: home });
  const original = await fs.readFile(config, "utf8");
  await assert.rejects(runInit({ target: "codex", homeDir: home, dir: path.join(home, "changed") }), /Conflicting agent-handoff/);
  await runInit({ target: "codex", homeDir: home, dir: path.join(home, "changed"), force: true });
  const parsed = parseToml(await fs.readFile(config, "utf8")) as any;
  assert.equal(parsed.model, "keep");
  assert.equal(parsed.mcp_servers["agent-handoff"].env.HANDOFF_DIR, path.join(home, "changed"));
  assert.ok((await backups(config)).length >= 2);
  assert.ok(original.includes("# BEGIN agent-handoff-mcp"));
});

test("Codex managed markers inside a TOML string cannot masquerade as installed service", async (t) => {
  const home = await sandbox(t), config = path.join(home, ".codex", "config.toml");
  const original = `example = '''\n# BEGIN agent-handoff-mcp\n[mcp_servers.agent-handoff]\ncommand = "npx"\nargs = ["-y","agent-handoff-mcp"]\n\n[mcp_servers.agent-handoff.env]\nHANDOFF_DIR = ${JSON.stringify(path.join(home, ".agent-handoff"))}\n# END agent-handoff-mcp\n'''\n`;
  await write(config, original);
  await assert.rejects(runInit({ target: "codex", homeDir: home }), /Conflicting agent-handoff/);
  await assert.rejects(runInit({ target: "codex", homeDir: home, force: true }), /do not identify an active/);
  assert.equal(await fs.readFile(config, "utf8"), original);
  assert.deepEqual(await backups(config), []);
});

test("CLI invalid/missing init options fail without writing any configuration", async (t) => {
  const home = await sandbox(t);
  const cli = fileURLToPath(new URL("../src/cli.js", import.meta.url));
  for (const args of [["--target"], ["--target", "typo"], ["--unknown"]]) {
    const result = spawnSync(process.execPath, [cli, "init", ...args], { encoding: "utf8", env: { ...process.env, HOME: home, USERPROFILE: home, HANDOFF_DIR: path.join(home, "data") } });
    assert.equal(result.status, 1);
    assert.doesNotMatch(result.stdout, /Configured MCP/);
  }
  assert.deepEqual(await fs.readdir(home), []);
});
