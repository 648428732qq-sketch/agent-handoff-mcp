# AI Agent 交接助手 · ai-agent-handoff-mcp

把一个 AI 对话的进展交给另一个 Agent：说“交接 主题”，保存独立 Markdown；换一个 Agent 说“继续 主题”，接着做。

用于 Codex、Claude Code、Cursor、Antigravity 之间的 **AI Agent 交接、上下文共享和对话接续**（AI agent handoff / context sharing）。

**转载需注明来源，未经许可禁止二次售卖。** 具体适用范围与历史版本说明见文末授权条款。

[提交问题](https://github.com/648428732qq-sketch/ai-agent-handoff-mcp/issues/new?template=bug_report.yml) · [功能建议](https://github.com/648428732qq-sketch/ai-agent-handoff-mcp/issues/new?template=feature_request.yml) · [Fork](https://github.com/648428732qq-sketch/ai-agent-handoff-mcp/fork) · [提交 PR](https://github.com/648428732qq-sketch/ai-agent-handoff-mcp/compare) · [npm](https://www.npmjs.com/package/agent-handoff-mcp)

## 安装

前置条件：**Node.js 20 或以上（含 npm）**，以及已安装、支持本地 stdio MCP 的 AI 客户端。首次安装需联网下载。

在终端执行：

```bash
npx -y agent-handoff-mcp@latest init
```

程序探测本机已有的 **Codex、Claude Code、Cursor、Antigravity** 配置目录，为找到的客户端配置 MCP、安装内置 Skill，并检查交接目录是否可写。

看到成功提示后，**重启对应客户端或重新加载 MCP，再新建对话**。客户端可能要求启用服务或允许工具调用，按它的提示完成即可。

默认数据保存在 `~/.agent-handoff/`。不需要先选路径、安装 Git、克隆仓库、编译源码或手动复制 Skill；**Obsidian/Wiki 也不是必需品**。

## 使用教程：用一个案例完成交接

**案例：用 Codex 开发网站登录功能，再换 Claude Code 继续。** 假设你已完成邮箱格式校验，接下来要补登录失败提示。以下是演示场景，登录功能由你的项目实现。

先让两个客户端都完成上面的安装，并在同一台电脑上打开同一个项目目录。两个客户端使用相同的交接目录即可；默认安装已统一使用 `~/.agent-handoff/`。

### 1. 在 Codex 中保存当前进展

在正在开发的对话中直接输入：

> 交接 登录功能。请保存当前目标、已完成内容、关键文件、采用的方案和下一步。已完成邮箱格式校验，下一步补登录失败提示和对应测试，继续使用项目现有的认证接口。

Codex 会整理当前对话并调用保存工具。保存后的交接摘要大致如下，具体文件路径由 Agent 根据你的项目填写：

| 摘要内容 | 本案例中的信息 |
|---|---|
| 主题 | 登录功能 |
| 当前目标 | 完成网站登录流程 |
| 已完成 | 邮箱格式校验 |
| 关键文件 | 当前项目中修改过的登录页面和测试文件 |
| 采用的方案 | 使用项目现有的认证接口 |
| 下一步 | 补登录失败提示和对应测试 |

看到保存成功和主题名后，就可以切换客户端。

### 2. 在 Claude Code 中恢复并继续

打开同一项目的新对话，输入：

> 继续 登录功能。先读取交接摘要，再从补登录失败提示和对应测试开始。

Claude Code 会加载“登录功能”这个主题，结合项目中的实际文件接着开发。交接提供任务摘要和文件线索，代码仍保存在原项目目录中。

如果不记得主题名，先说 **“看交接”**，从列表里选一个，再说“继续 主题名”。

### 3. 再次切换时更新同一个主题

例如 Claude Code 已补好失败提示，你准备换回 Codex 检查跳转，可以说：

> 交接 登录功能。请按当前进展更新这个主题：失败提示和对应测试已完成，下一步检查登录成功后的跳转。

然后在 Codex 中说 **“继续 登录功能”**，即可读取更新后的进展。同名保存会更新这个主题；其他任务使用不同主题名。

### 4. 做完后结束交接

> 结束交接 登录功能。

这会删除该主题的活跃交接文件并更新列表。需要保留记录时，可以说“结束交接 登录功能，并归档到 C:/AgentData/handoff-archive”；归档目录换成你自己的路径。

### 常用说法速查

| 想做什么 | 对 Agent 说 |
|---|---|
| 保存或更新当前主题 | 交接 登录功能 |
| 查看已有主题 | 看交接 |
| 恢复指定主题 | 继续 登录功能 |
| 结束一个主题 | 结束交接 登录功能 |
| 给网页版 AI 使用 | 导出 登录功能 |

有多个候选而只说“继续”时，先选择主题。保存由明确的交接指令触发。

Skill 提供这些协作规则，MCP 工具执行实际文件操作。客户端对 Skill、Prompt 的显示方式不同；无需记住各自的斜杠命令。

![交接流程](https://raw.githubusercontent.com/648428732qq-sketch/ai-agent-handoff-mcp/main/docs/images/handoff-workflow.png)

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

没有探测到客户端时，先安装并启动一次你的 AI 客户端，或明确指定目标：

```bash
npx -y agent-handoff-mcp@latest init --target codex
```

将 `codex` 换成 `claude`、`cursor` 或 `antigravity` 即可。默认安装只处理探测到的客户端。已有相同配置会保留；不同的自定义配置或同名 Skill 会保留并提示冲突，处理方式见[高级教程](https://github.com/648428732qq-sketch/ai-agent-handoff-mcp/blob/main/docs/advanced.md)。

先检查环境：

```bash
npx -y agent-handoff-mcp@latest doctor
```

需要反馈时生成报告：

```bash
npx -y agent-handoff-mcp@latest report
```

如果使用了自定义交接目录，请在命令后加相同的 `--dir "你的目录"`。核对报告内容后，通过文首“提交问题”发给维护者。

详细配置、CLI 用法、诊断、数据边界、源码开发和贡献步骤均在[高级教程](https://github.com/648428732qq-sketch/ai-agent-handoff-mcp/blob/main/docs/advanced.md)。安装只使用本地 Markdown，无需单独的数据库、服务器或 API Key；AI 客户端的账号和模型由客户端配置。

## 参与改进

欢迎提交 Issue 或 Fork 后发起 PR。修改后运行 `npm test`，在 PR 中说明解决的问题和验证结果；维护者审核后合并。

## 转载与使用授权

- 转载、分享或分发时，须注明原创作者 **648428732qq-sketch**，附上[本仓库来源链接](https://github.com/648428732qq-sketch/ai-agent-handoff-mcp)，并保留版权及授权文件。
- 允许免费使用、修改和免费分享。**未经作者书面许可，禁止二次售卖**，包括改名、修改、重新打包或捆绑后对软件副本进行收费分发。
- 企业内部使用，以及不对软件副本分发收费的独立咨询或支持服务可以进行。第三方依赖保留各自许可。

新版本采用[署名与禁止转售许可](https://github.com/648428732qq-sketch/ai-agent-handoff-mcp/blob/main/LICENSE)，属于源码公开的自定义授权。

**历史许可说明：** `0.2.1` 及更早版本和已按 MIT 授权的原有代码，继续保留原授权权利；新条款不追溯撤销这些权利。原授权全文见 [docs/legal/mit-legacy-notice.txt](https://github.com/648428732qq-sketch/ai-agent-handoff-mcp/blob/main/docs/legal/mit-legacy-notice.txt)。
