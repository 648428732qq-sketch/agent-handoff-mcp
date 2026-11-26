import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  collectDiagnostics,
  formatBugReportMarkdown,
} from "../src/diagnostics.js";
import { DiagnosticsLogger, sanitizeText } from "../src/logger.js";
import { LocalMarkdownStore, slugifyTopic } from "../src/store.js";

test("slugifyTopic preserves Chinese and strips unsafe characters", () => {
  assert.equal(slugifyTopic("语音唤醒延迟 / v2"), "语音唤醒延迟-v2");
  assert.equal(slugifyTopic("  kws_latency:fix  "), "kws_latency-fix");
  assert.throws(() => slugifyTopic("..."));
});

test("sanitizeText redacts user home directories and usernames", () => {
  const winSample = "ENOENT: open C:\\Users\\Alice\\secret\\file.md";
  assert.doesNotMatch(sanitizeText(winSample), /Alice/);
  const unixSample = "ENOENT: open /Users/bob/secret/file.md";
  assert.doesNotMatch(sanitizeText(unixSample), /bob/);
});

test("LocalMarkdownStore isolates parallel threads without overwriting", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-handoff-test-"));
  const archiveDir = path.join(tmpDir, "_archive");

  try {
    const store = new LocalMarkdownStore(tmpDir);

    await store.save({
      topic: "kws-latency",
      goal: "- Reduce wake-word latency below 120ms",
      progress: "- Profiled audio buffer in kws.py",
      decisions: "- Keep streaming chunk at 20ms",
      nextSteps: "- Benchmark quantized ONNX model",
      sourceAgent: "Codex",
      project: "baby_agent_system",
    });

    await store.save({
      topic: "rag-research",
      goal: "- Compare hybrid retrieval rerankers",
      progress: "- Tested bge-reranker-v2-m3",
      nextSteps: "- Write evaluation summary",
      sourceAgent: "Antigravity",
      project: null,
    });

    const all = await store.list();
    assert.equal(all.length, 2);

    const babyOnly = await store.list("baby_agent_system");
    assert.equal(babyOnly.length, 1);
    assert.equal(babyOnly[0].topic, "kws-latency");

    const loaded = await store.load("kws");
    assert.ok(loaded);
    assert.match(loaded.content, /Benchmark quantized ONNX model/);

    const exported = await store.exportPrompt("rag-research");
    assert.ok(exported);
    assert.match(exported, /Antigravity/);
    assert.match(exported, /Write evaluation summary/);

    const closed = await store.close("kws-latency", archiveDir);
    assert.ok(closed);
    assert.ok(closed.archivedFile);
    const archivedContent = await fs.readFile(closed.archivedFile, "utf8");
    assert.match(archivedContent, /kws-latency/);

    const remaining = await store.list();
    assert.equal(remaining.length, 1);
    assert.equal(remaining[0].topic, "rag-research");

    // Verify diagnostics logger & sanitized bug report
    const logger = new DiagnosticsLogger(tmpDir);
    await logger.write({
      level: "error",
      event: "tool_call",
      op: "handoff_load",
      ok: false,
      errorCode: "ENOENT",
      errorMessage: "Failed reading C:\\Users\\Alice\\test.md",
    });

    const diag = await collectDiagnostics(tmpDir, 20);
    assert.equal(diag.handoffDirWritable, true);
    assert.equal(diag.activeSlotCount, 1);
    assert.equal(diag.recentLogs.length, 1);
    assert.doesNotMatch(diag.recentLogs[0], /Alice/);

    const md = formatBugReportMarkdown(diag);
    assert.match(md, /issues\/new\?template=bug_report\.yml/);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});
