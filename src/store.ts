import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {
  CloseHandoffResult,
  HandoffIndexEntry,
  HandoffStore,
  SaveHandoffInput,
} from "./types.js";

/**
 * Sanitize a topic name into a safe cross-platform filename slug.
 * Preserves Unicode letters/digits (including Chinese), `_`, and `-`.
 */
export function slugifyTopic(raw: string): string {
  const cleaned = raw
    .trim()
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/[^\p{L}\p{N}_-]+/gu, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);

  if (!cleaned || cleaned === "." || cleaned === "..") {
    throw new Error(`Invalid topic name: "${raw}"`);
  }
  return cleaned;
}

export function resolveHandoffDir(explicitDir?: string): string {
  const chosen = explicitDir || process.env.HANDOFF_DIR;
  if (chosen && chosen.trim()) {
    return path.resolve(chosen.replace(/^~(?=$|[\\/])/, os.homedir()));
  }
  return path.join(os.homedir(), ".agent-handoff");
}

function nowIsoLocal(): string {
  const d = new Date();
  const offsetMin = -d.getTimezoneOffset();
  const sign = offsetMin >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMin);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${sign}${hh}:${mm}`;
}

function escapeYamlScalar(val: string | null | undefined): string {
  if (val === null || val === undefined || val.trim() === "") return "null";
  const singleLine = val.replace(/\r?\n/g, " ").trim();
  if (/[:#[\]{}&*!|>'"%@`]/.test(singleLine) || /^\s|\s$/.test(singleLine)) {
    return JSON.stringify(singleLine);
  }
  return singleLine;
}

function parseFrontmatter(content: string): Record<string, string> {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const result: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      try {
        value = JSON.parse(value);
      } catch {
        value = value.slice(1, -1);
      }
    }
    if (value === "null") value = "";
    result[key] = value;
  }
  return result;
}

function escapeTableCell(val: string): string {
  return val.replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim() || "-";
}

function formatSection(text: string | undefined, fallback: string): string {
  const trimmed = (text ?? "").trim();
  return trimmed ? trimmed : fallback;
}

async function atomicWrite(filePath: string, content: string): Promise<void> {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmpPath, content, "utf8");
  await fs.rename(tmpPath, filePath);
}

export class LocalMarkdownStore implements HandoffStore {
  public readonly baseDir: string;
  private readonly threadsDir: string;
  private readonly indexFile: string;
  private readonly currentFile: string;

  constructor(baseDir?: string) {
    this.baseDir = resolveHandoffDir(baseDir);
    this.threadsDir = path.join(this.baseDir, "threads");
    this.indexFile = path.join(this.baseDir, "index.md");
    this.currentFile = path.join(this.baseDir, "current.md");
  }

  private async ensureDirs(): Promise<void> {
    await fs.mkdir(this.threadsDir, { recursive: true });
  }

  private async scanAllEntries(): Promise<HandoffIndexEntry[]> {
    await this.ensureDirs();
    const files = await fs.readdir(this.threadsDir);
    const entries: HandoffIndexEntry[] = [];

    for (const file of files) {
      if (!file.endsWith(".md") || file.startsWith("_")) continue;
      const fullPath = path.join(this.threadsDir, file);
      const raw = await fs.readFile(fullPath, "utf8");
      const fm = parseFrontmatter(raw);
      const topic = fm.topic || file.replace(/\.md$/i, "");
      entries.push({
        topic,
        project: fm.project || null,
        sourceAgent: fm.source_agent || "unknown",
        updated: fm.updated || "",
        summary: fm.summary || "",
        filePath: fullPath,
      });
    }

    entries.sort((a, b) => (b.updated || "").localeCompare(a.updated || ""));
    return entries;
  }

  private async rebuildIndex(entries: HandoffIndexEntry[]): Promise<void> {
    const updated = nowIsoLocal();
    const rows =
      entries.length > 0
        ? entries
            .map(
              (e) =>
                `| ${escapeTableCell(e.topic)} | ${escapeTableCell(
                  e.project ?? "-"
                )} | ${escapeTableCell(e.sourceAgent)} | ${escapeTableCell(
                  e.updated
                )} | ${escapeTableCell(e.summary)} |`
            )
            .join("\n")
        : `| *(暂无活跃交接)* | - | - | - | - |`;

    const md = `---
updated: ${updated}
---

# 活跃交接索引（Active Handoff Threads）

> 每个独立对话对应 \`threads/<topic-slug>.md\`，互不覆盖、防止串台。仅在用户明确触发「交接 / handoff」时更新。

| 槽位 (topic) | 所属项目 | 来源 Agent | 更新时间 | 一句话进度 |
| :--- | :--- | :--- | :--- | :--- |
${rows}
`;
    await atomicWrite(this.indexFile, md);
  }

  private async resolveThreadFile(
    topicQuery: string
  ): Promise<HandoffIndexEntry | null> {
    const entries = await this.scanAllEntries();
    if (entries.length === 0) return null;

    const q = topicQuery.trim();
    const qSlug = (() => {
      try {
        return slugifyTopic(q).toLowerCase();
      } catch {
        return q.toLowerCase();
      }
    })();

    // 1. Exact topic or slug match
    const exact = entries.find(
      (e) =>
        e.topic.toLowerCase() === q.toLowerCase() ||
        path.basename(e.filePath, ".md").toLowerCase() === qSlug
    );
    if (exact) return exact;

    // 2. Unambiguous substring match
    const partial = entries.filter(
      (e) =>
        e.topic.toLowerCase().includes(q.toLowerCase()) ||
        path.basename(e.filePath, ".md").toLowerCase().includes(qSlug)
    );
    if (partial.length === 1) return partial[0];

    return null;
  }

  async list(project?: string): Promise<HandoffIndexEntry[]> {
    const entries = await this.scanAllEntries();
    if (!project || !project.trim()) return entries;
    const p = project.trim().toLowerCase();
    return entries.filter((e) => (e.project ?? "").toLowerCase().includes(p));
  }

  async load(
    topic: string
  ): Promise<{ entry: HandoffIndexEntry; content: string } | null> {
    const entry = await this.resolveThreadFile(topic);
    if (!entry) return null;
    const content = await fs.readFile(entry.filePath, "utf8");
    return { entry, content };
  }

  async save(input: SaveHandoffInput): Promise<HandoffIndexEntry> {
    await this.ensureDirs();
    const slug = slugifyTopic(input.topic);
    const updated = nowIsoLocal();
    const sourceAgent = (input.sourceAgent || "unknown").trim();
    const project = input.project?.trim() || null;
    const workspace = input.workspace?.trim() || null;
    const summary = (
      input.summary?.trim() ||
      input.goal.split(/\r?\n/)[0].replace(/^[-*]\s*/, "").slice(0, 80)
    ).trim();

    const filePath = path.join(this.threadsDir, `${slug}.md`);
    const threadMd = `---
topic: ${escapeYamlScalar(slug)}
updated: ${updated}
source_agent: ${escapeYamlScalar(sourceAgent)}
project: ${escapeYamlScalar(project)}
workspace: ${escapeYamlScalar(workspace)}
summary: ${escapeYamlScalar(summary)}
---

# 独立交接：${slug}

## 当前目标
${formatSection(input.goal, "- (未填写)")}

## 已完成进展与关键文件
${formatSection(input.progress, "- (未填写)")}

## 关键决策与踩坑
${formatSection(input.decisions, "- (无)")}

## 下一步行动
${formatSection(input.nextSteps, "- (未填写)")}
`;

    await atomicWrite(filePath, threadMd);

    const currentMd = `---
topic: ${escapeYamlScalar(slug)}
thread_file: ${escapeYamlScalar(filePath)}
updated: ${updated}
source_agent: ${escapeYamlScalar(sourceAgent)}
project: ${escapeYamlScalar(project)}
---

# 最近一次交接指针

- **槽位**：\`${slug}\`
- **来源 Agent**：${sourceAgent}
- **所属项目**：${project ?? "-"}
- **一句话进度**：${summary}
- **完整内容**：\`${filePath}\`
`;
    await atomicWrite(this.currentFile, currentMd);

    const all = await this.scanAllEntries();
    await this.rebuildIndex(all);

    return {
      topic: slug,
      project,
      sourceAgent,
      updated,
      summary,
      filePath,
    };
  }

  async close(
    topic: string,
    archiveDir?: string
  ): Promise<CloseHandoffResult | null> {
    const entry = await this.resolveThreadFile(topic);
    if (!entry) return null;

    let archivedFile: string | undefined;
    if (archiveDir && archiveDir.trim()) {
      const resolvedArchive = path.resolve(
        archiveDir.replace(/^~(?=$|[\\/])/, os.homedir())
      );
      await fs.mkdir(resolvedArchive, { recursive: true });
      const datePrefix = nowIsoLocal().slice(0, 10);
      archivedFile = path.join(
        resolvedArchive,
        `${datePrefix}-handoff-${entry.topic}.md`
      );
      const content = await fs.readFile(entry.filePath, "utf8");
      await atomicWrite(archivedFile, content);
    }

    await fs.unlink(entry.filePath);
    const remaining = await this.scanAllEntries();
    await this.rebuildIndex(remaining);

    return {
      topic: entry.topic,
      removedFile: entry.filePath,
      archivedFile,
    };
  }

  async exportPrompt(topic: string): Promise<string | null> {
    const loaded = await this.load(topic);
    if (!loaded) return null;
    return [
      `以下是我从另一个 AI Agent（${loaded.entry.sourceAgent}）迁移过来的独立对话交接上下文，请先阅读并直接接着「下一步行动」继续推进，无需重复寒暄：`,
      "",
      "```markdown",
      loaded.content.trim(),
      "```",
    ].join("\n");
  }
}
