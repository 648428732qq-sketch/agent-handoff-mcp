# agent-handoff-mcp

把一个 AI 对话的进展交给另一个 Agent：说“交接 主题”，保存独立 Markdown；换一个 Agent 说“继续 主题”，接着做。

[提交问题](https://github.com/648428732qq-sketch/agent-handoff-mcp/issues/new?template=bug_report.yml) · [功能建议](https://github.com/648428732qq-sketch/agent-handoff-mcp/issues/new?template=feature_request.yml) · [Fork](https://github.com/648428732qq-sketch/agent-handoff-mcp/fork) · [提交 PR](https://github.com/648428732qq-sketch/agent-handoff-mcp/compare) · [npm](https://www.npmjs.com/package/agent-handoff-mcp)

## 开始使用

前置条件：**Node.js 20 或以上（含 npm）**，以及已安装、支持本地 stdio MCP 的 AI 客户端。首次安装需联网下载。

在终端执行：

```bash
npx -y agent-handoff-mcp@latest init
```

程序探测本机已有的 **Codex、Claude Code、Cursor、Antigravity** 配置目录，为找到的客户端配置 MCP、安装内置 Skill，并检查交接目录是否可写。

看到成功提示后，**重启对应客户端或重新加载 MCP，再新建对话**。客户端可能要求启用服务或允许工具调用，按它的提示完成即可。

默认数据保存在 `~/.agent-handoff/`。不需要先选路径、安装 Git、克隆仓库、编译源码或手动复制 Skill；**Obsidian/Wiki 也不是必需品**。

### 没有探测到客户端

先安装并启动一次你的 AI 客户端，或明确指定目标，例如：

```bash
npx -y agent-handoff-mcp@latest init --target codex
```

将 `codex` 换成 `claude`、`cursor` 或 `antigravity` 即可。默认安装只处理探测到的客户端；不会因为未找到配置就给全部客户端创建目录。

已有相同配置会保留；遇到不同的自定义配置或同名 Skill，程序会保留原文件并说明冲突。[高级教程](https://github.com/648428732qq-sketch/agent-handoff-mcp/blob/main/docs/advanced.md)介绍目录、备份及 `--force` 的处理方式。

## 完成一次交接

在 Agent A 中输入：

> 交接 登录功能。请保存当前目标、已完成内容、关键决策和下一步。

然后在同一台电脑的 Agent B 中输入：

> 继续 登录功能。

两个客户端需使用同一交接目录；默认安装会使用相同的默认目录。Agent 会读取该主题的摘要，继续下一步。

| 想做什么 | 对 Agent 说 |
|---|---|
| 保存或更新当前主题 | 交接 登录功能 |
| 查看已有主题 | 看交接 |
| 恢复指定主题 | 继续 登录功能 |
| 结束一个主题 | 结束交接 登录功能 |
| 给网页版 AI 使用 | 导出 登录功能 |

不同对话请使用不同主题名。同名保存会更新原主题；有多个候选而只说“继续”时，先选择主题。保存由明确的交接指令触发。

Skill 提供这些协作规则，MCP 工具执行实际文件操作。客户端对 Skill、Prompt 的显示方式不同；无需记住各自的斜杠命令。

![交接流程](https://raw.githubusercontent.com/648428732qq-sketch/agent-handoff-mcp/main/docs/images/handoff-workflow.png)

## 想放进 Obsidian Wiki？

可选。在安装时指定已有 Vault 中的交接子目录：

```bash
npx -y agent-handoff-mcp@latest init --dir "C:/notes/wiki-vault/_handoff"
```

把示例路径换成自己的目录；macOS、Linux 使用相应路径。若已经配置过另一个目录，先按冲突提示处理，避免误切换数据位置。

已有的 `AGENTS.md` 或 `SHARED_AGENTS.md` 也应使用相同目录。工具管理交接摘要，**不会自动导入、搜索整个 Wiki，也不会自动同步不同设备**。跨设备使用时，需要自行同步交接文件。

## 支持范围

| 客户端 | 安装方式 |
|---|---|
| Codex、Claude Code、Cursor、Antigravity | `init` 自动探测并安装 MCP 与 Skill |
| Trae、WorkBuddy | `init --target trae` / `workbuddy` 输出 JSON，需在客户端手动接入 |
| ChatGPT、Claude、Gemini 等网页版 AI | 在本地 Agent 中导出主题，再粘贴到网页对话 |

自动安装针对本机个人配置；远程、云端或组织管理的环境可能有独立设置。安装结果以终端输出和客户端实际发现的工具为准。

## 遇到问题

先检查环境：

```bash
npx -y agent-handoff-mcp@latest doctor
```

需要反馈时生成报告：

```bash
npx -y agent-handoff-mcp@latest report
```

如果使用了自定义交接目录，请在命令后加相同的 `--dir "你的目录"`。核对报告内容后，通过文首“提交问题”发给维护者。

详细配置、CLI 用法、诊断、数据边界、源码开发和贡献步骤均在[高级教程](https://github.com/648428732qq-sketch/agent-handoff-mcp/blob/main/docs/advanced.md)。安装只使用本地 Markdown，无需单独的数据库、服务器或 API Key；AI 客户端的账号和模型由客户端配置。

## 参与改进

欢迎提交 Issue 或 Fork 后发起 PR。修改后运行 `npm test`，在 PR 中说明解决的问题和验证结果；维护者审核后合并。

[MIT License](https://github.com/648428732qq-sketch/agent-handoff-mcp/blob/main/LICENSE)
