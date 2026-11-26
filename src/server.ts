import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  collectDiagnostics,
  formatBugReportMarkdown,
  PACKAGE_VERSION,
} from "./diagnostics.js";
import { DiagnosticsLogger } from "./logger.js";
import { LocalMarkdownStore } from "./store.js";
import type { HandoffStore } from "./types.js";

async function traced<T>(
  logger: DiagnosticsLogger,
  op: string,
  meta: Record<string, string | number | boolean | null>,
  fn: () => Promise<T>
): Promise<T> {
  const start = Date.now();
  try {
    const res = await fn();
    await logger.write({
      level: "info",
      event: "tool_call",
      op,
      durationMs: Date.now() - start,
      ok: true,
      meta,
    });
    return res;
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    await logger.write({
      level: "error",
      event: "tool_call",
      op,
      durationMs: Date.now() - start,
      ok: false,
      errorCode: e.code || e.name || "ERR_UNKNOWN",
      errorMessage: e.message || String(err),
      meta,
    });
    throw err;
  }
}

export function createHandoffServer(store: HandoffStore): McpServer {
  const logger = new DiagnosticsLogger(store.baseDir);
  const server = new McpServer({
    name: "agent-handoff-mcp",
    version: PACKAGE_VERSION,
  });

  // 1. Resource: lightweight index table (never dumps thread bodies)
  server.resource(
    "handoff-index",
    "handoff://index",
    {
      description:
        "Active isolated conversation handoff slots (index only, safe against cross-thread bleed).",
      mimeType: "text/markdown",
    },
    async () => {
      const entries = await traced(logger, "resource:index", {}, () =>
        store.list()
      );
      const text =
        entries.length === 0
          ? "No active handoff threads."
          : entries
              .map(
                (e, i) =>
                  `${i + 1}. [${e.topic}] project=${e.project ?? "-"} | from=${e.sourceAgent} | updated=${e.updated} | ${e.summary}`
              )
              .join("\n");
      return {
        contents: [
          {
            uri: "handoff://index",
            mimeType: "text/markdown",
            text,
          },
        ],
      };
    }
  );

  // 2. Tool: handoff_list
  server.tool(
    "handoff_list",
    "List active isolated conversation handoff slots (index only, no full bodies, preventing cross-conversation bleed). Optionally filter by project name.",
    {
      project: z
        .string()
        .optional()
        .describe("Optional project name filter (case-insensitive substring)."),
    },
    async ({ project }) => {
      const entries = await traced(
        logger,
        "handoff_list",
        { hasProjectFilter: Boolean(project) },
        () => store.list(project)
      );
      if (entries.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: project
                ? `No active handoff slots matching project "${project}".`
                : "No active handoff slots.",
            },
          ],
        };
      }

      const lines = entries.map(
        (e, idx) =>
          `${idx + 1}. **${e.topic}** | project: ${e.project ?? "-"} | from: ${e.sourceAgent} | updated: ${e.updated}\n   - ${e.summary}`
      );
      return {
        content: [
          {
            type: "text",
            text: `Active handoff slots (${entries.length}):\n\n${lines.join("\n")}`,
          },
        ],
      };
    }
  );

  // 3. Tool: handoff_load
  server.tool(
    "handoff_load",
    "Load the full context of a single isolated handoff slot by topic name. Only call after the user explicitly asks to resume/continue a specific thread.",
    {
      topic: z
        .string()
        .min(1)
        .describe("Topic slug or unambiguous partial name from handoff_list."),
    },
    async ({ topic }) => {
      const loaded = await traced(
        logger,
        "handoff_load",
        { topicLen: topic.length },
        () => store.load(topic)
      );
      if (!loaded) {
        const all = await store.list();
        const available =
          all.length > 0
            ? `Available slots: ${all.map((e) => e.topic).join(", ")}`
            : "No active handoff slots exist.";
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Could not uniquely match handoff slot "${topic}". ${available}`,
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text",
            text: loaded.content,
          },
        ],
      };
    }
  );

  // 4. Tool: handoff_save
  server.tool(
    "handoff_save",
    "Save or update an isolated conversation handoff slot. ONLY call when the user explicitly asks to handoff / save context (e.g. '交接', 'handoff'). Never auto-save without user intent.",
    {
      topic: z
        .string()
        .min(1)
        .describe(
          "Short unique topic slug for this conversation (e.g. 'kws-latency', '语音唤醒延迟')."
        ),
      goal: z
        .string()
        .min(1)
        .describe("Current objective of this conversation (concise bullets)."),
      progress: z
        .string()
        .min(1)
        .describe("Completed work and key modified/relevant files."),
      decisions: z
        .string()
        .optional()
        .describe("Key architecture decisions, constraints, and gotchas."),
      nextSteps: z
        .string()
        .min(1)
        .describe("Concrete next actions for the receiving agent."),
      summary: z
        .string()
        .optional()
        .describe("One-line progress summary (<= 80 chars) for index.md."),
      sourceAgent: z
        .string()
        .optional()
        .describe(
          "Name of the agent writing this handoff (e.g. 'Antigravity', 'Codex', 'Trae', 'WorkBuddy', 'Claude Code', 'Cursor')."
        ),
      project: z
        .string()
        .optional()
        .nullable()
        .describe("Project name if tied to a repository, else null."),
      workspace: z
        .string()
        .optional()
        .nullable()
        .describe("Absolute workspace path if applicable, else null."),
    },
    async (args) => {
      // Never log private conversation body content; log only safe operational metadata
      const entry = await traced(
        logger,
        "handoff_save",
        {
          sourceAgent: args.sourceAgent ?? "unknown",
          hasProject: Boolean(args.project),
          bodyBytes:
            args.goal.length +
            args.progress.length +
            (args.decisions?.length ?? 0) +
            args.nextSteps.length,
        },
        () =>
          store.save({
            topic: args.topic,
            goal: args.goal,
            progress: args.progress,
            decisions: args.decisions,
            nextSteps: args.nextSteps,
            summary: args.summary,
            sourceAgent: args.sourceAgent,
            project: args.project ?? null,
            workspace: args.workspace ?? null,
          })
      );

      return {
        content: [
          {
            type: "text",
            text: `Saved isolated handoff slot "${entry.topic}" -> ${entry.filePath}\nIn another agent, say: "继续 ${entry.topic}" (or call handoff_load with topic="${entry.topic}").`,
          },
        ],
      };
    }
  );

  // 5. Tool: handoff_close
  server.tool(
    "handoff_close",
    "Close and remove a finished handoff slot so active slots stay clean. Optionally archive a copy to a directory (e.g. Obsidian Wiki _raw/).",
    {
      topic: z.string().min(1).describe("Topic name to close and remove."),
      archiveDir: z
        .string()
        .optional()
        .describe(
          "Optional directory path to save a dated archive copy before deleting (e.g. Obsidian vault _raw/ folder)."
        ),
    },
    async ({ topic, archiveDir }) => {
      const result = await traced(
        logger,
        "handoff_close",
        { archived: Boolean(archiveDir) },
        () => store.close(topic, archiveDir)
      );
      if (!result) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Handoff slot "${topic}" not found.`,
            },
          ],
        };
      }
      const archiveNote = result.archivedFile
        ? `\nArchived copy: ${result.archivedFile}`
        : "";
      return {
        content: [
          {
            type: "text",
            text: `Closed handoff slot "${result.topic}" (removed ${result.removedFile}).${archiveNote}`,
          },
        ],
      };
    }
  );

  // 6. Tool: handoff_export
  server.tool(
    "handoff_export",
    "Render an isolated handoff slot as a ready-to-paste prompt for web-based AI tools (ChatGPT, Claude Web, Gemini Web) that do not support MCP.",
    {
      topic: z.string().min(1).describe("Topic name to export."),
    },
    async ({ topic }) => {
      const prompt = await traced(logger, "handoff_export", {}, () =>
        store.exportPrompt(topic)
      );
      if (!prompt) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Handoff slot "${topic}" not found.`,
            },
          ],
        };
      }
      return {
        content: [
          {
            type: "text",
            text: prompt,
          },
        ],
      };
    }
  );

  // 7. Tool: handoff_diagnostics (privacy-safe bug report bundle)
  server.tool(
    "handoff_diagnostics",
    "Generate a privacy-safe diagnostic report (version, OS, directory health, sanitized JSONL logs, GitHub Issue link) for troubleshooting or bug submission. Never includes private conversation content.",
    {
      maxLines: z
        .number()
        .int()
        .min(5)
        .max(200)
        .optional()
        .describe("Maximum number of recent log lines to include (default 50)."),
    },
    async ({ maxLines }) => {
      const diag = await collectDiagnostics(store.baseDir, maxLines ?? 50);
      return {
        content: [
          {
            type: "text",
            text: formatBugReportMarkdown(diag),
          },
        ],
      };
    }
  );

  // 8. MCP Prompts (auto-exposed as slash commands in WorkBuddy, Claude Code, etc.)
  server.prompt(
    "save",
    "Summarize the current conversation into an isolated handoff slot.",
    {
      topic: z
        .string()
        .optional()
        .describe("Optional slot name; if omitted, infer a short unique topic slug."),
    },
    async ({ topic }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: topic
              ? `请将当前对话的核心目标、已完成进展与关键文件、关键决策与踩坑、下一步行动精简提炼（控制在 40 行以内），调用 handoff_save 工具保存到独立槽位 "${topic}"。`
              : `请将当前对话的核心目标、已完成进展与关键文件、关键决策与踩坑、下一步行动精简提炼（控制在 40 行以内），先自动生成一个简短唯一的 topic 名称（不与现有无关槽位冲突），再调用 handoff_save 工具保存。`,
          },
        },
      ],
    })
  );

  server.prompt(
    "resume",
    "Resume an isolated conversation handoff slot without cross-thread bleed.",
    {
      topic: z
        .string()
        .optional()
        .describe("Optional topic name to load; if omitted, list active slots first."),
    },
    async ({ topic }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: topic
              ? `请调用 handoff_load 读取槽位 "${topic}" 的上下文，简要确认已恢复的进度并直接继续下一步。`
              : `请先调用 handoff_list 查看活跃交接槽位：若只有 1 个候选（或当前项目恰好只有 1 个匹配槽位）则调用 handoff_load 恢复；若存在多个候选，先列出编号让我选择，不要猜测串台。`,
          },
        },
      ],
    })
  );

  server.prompt(
    "list",
    "List all active isolated handoff slots.",
    async () => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: "请调用 handoff_list 展示当前所有活跃的独立交接槽位。",
          },
        },
      ],
    })
  );

  return server;
}

export async function runStdioServer(handoffDir?: string): Promise<void> {
  const store = new LocalMarkdownStore(handoffDir);
  const logger = new DiagnosticsLogger(store.baseDir);
  await logger.write({
    level: "info",
    event: "server_start",
    ok: true,
    meta: { version: PACKAGE_VERSION, node: process.version },
  });
  const server = createHandoffServer(store);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
