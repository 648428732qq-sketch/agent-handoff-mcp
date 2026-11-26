---
name: agent-handoff
description: >-
  Cross-agent isolated conversation handoff protocol powered by agent-handoff-mcp.
  Use ONLY when the user explicitly asks to handoff/save context ("交接", "handoff",
  "保存现场"), resume a previous thread ("继续 <topic>", "看交接"), or close a finished
  handoff slot ("结束交接 <topic>"). Prevents cross-conversation bleed across Antigravity,
  Codex, Trae, WorkBuddy, Claude Code, Cursor, and Web AI.
---

# Agent Handoff Protocol (Multi-Thread Isolated)

Use the `agent-handoff` MCP tools (`handoff_list`, `handoff_load`, `handoff_save`, `handoff_close`, `handoff_export`) with strict anti-bleed discipline:

## 1. Anti-Bleed Rules
- **New topic = clean slate**: When the user starts an unrelated topic, ignore all previous handoff slots.
- **One thread = one slot**: Never overwrite an unrelated conversation's slot.
- **Confirm when ambiguous**: If the user says only "继续" / "resume" and `handoff_list` returns multiple candidates (or none uniquely matching the current workspace project), list the numbered slots and ask the user to choose before calling `handoff_load`.

## 2. Commands
- **Save (`交接 [topic]` / `handoff [topic]`)**:
  - **Trigger strictly on explicit user command** — never auto-save on normal turns.
  - Distill the conversation into concise bullets (≤ 40 lines total): `goal`, `progress`, `decisions`, `nextSteps`, and a 1-line `summary`.
  - Call `handoff_save` with the user's `topic` (or infer a short unique slug if omitted) and your `sourceAgent` name.
  - Reply with the saved slot name and resume command: `继续 <topic>`.
- **Resume (`继续 <topic>` / `resume <topic>`)**:
  - Call `handoff_load(topic)` and continue directly from `nextSteps`.
- **List (`看交接` / `handoff list`)**:
  - Call `handoff_list()` and present the active slots.
- **Close (`结束交接 <topic>` / `close handoff <topic>`)**:
  - Call `handoff_close(topic)` (pass `archiveDir` if the user wants to archive into Obsidian `_raw/`).
- **Export for Web AI (`导出交接 <topic>`)**:
  - Call `handoff_export(topic)` so the user can copy-paste into ChatGPT / Claude / Gemini web UI.
