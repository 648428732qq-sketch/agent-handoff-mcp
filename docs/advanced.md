# 高级配置与开发教程

日常使用先看[README 快速开始](https://github.com/648428732qq-sketch/agent-handoff-mcp#readme)。本文面向需要自定义目录、手动配置、排查冲突或参与开发的用户，适用于 0.2.0 及之后版本。

## 安装选项与重复运行

```bash
npx -y agent-handoff-mcp@latest init
npx -y agent-handoff-mcp@latest init --target codex
npx -y agent-handoff-mcp@latest init --target claude
npx -y agent-handoff-mcp@latest init --target cursor
npx -y agent-handoff-mcp@latest init --target antigravity
```

默认目标为 `auto`，探测已存在的个人配置目录：Codex 的 `~/.codex/`，Claude Code 的 `~/.claude/` 或 `~/.claude.json`，Cursor 的 `~/.cursor/`，Antigravity 的 `~/.gemini/config/` 或旧版 `~/.gemini/antigravity/`。探测只表示发现本机配置痕迹，不代表客户端已启动、登录或加载工具。

没有探测到目标时，程序给出指定 `--target` 的用法。明确指定目标可为该客户端创建所需配置。兼容选项 `--target all` 会处理四个可自动安装的目标；通常无需使用它。

安装只检查数据目录可写性，不会创建交接主题、`index.md` 或 `current.md`。安装会配置名为 `agent-handoff` 的 MCP 服务，并安装内置 `agent-handoff` Skill。相同内容重复运行不改文件；不同的自定义配置或同名 Skill 默认保留并报告冲突。请先看输出中每个目标的结果。

### 冲突、备份与 --force

确认需要替换该工具的旧配置或同名 Skill 时，可以再次运行：

```bash
npx -y agent-handoff-mcp@latest init --target cursor --force
```

`--force` 用于冲突替换；被替换的文件先备份，具体备份路径见安装输出。无关 MCP 服务与其他 Skill 应继续保留。数据目录中的交接正文不会因为安装而迁移或清空。

Codex 配置是 TOML，可能包含内联表、引用名称或其他自定义写法。遇到安装器不能安全处理的结构，即使使用 `--force` 也可能需要手动修改；按终端提示处理，不要直接覆盖整个配置文件。需要回退时，先退出对应客户端，再用安装输出中的备份恢复相应文件。

## 配置和 Skill 的位置

`~` 表示当前用户主目录。以下是安装器使用的个人配置位置；组织配置、项目作用域、远程主机或客户端版本可能使用其他入口。

| 客户端 | MCP 配置 | Skill 目录 |
|---|---|---|
| Codex | `~/.codex/config.toml` | `~/.agents/skills/agent-handoff/` |
| Claude Code | `~/.claude.json` | `~/.claude/skills/agent-handoff/` |
| Cursor | `~/.cursor/mcp.json` | `~/.cursor/skills/agent-handoff/` |
| Antigravity | `~/.gemini/config/mcp_config.json` | `~/.gemini/config/skills/agent-handoff/` |

Antigravity 当前配置不存在而已有旧版 `~/.gemini/antigravity/mcp_config.json` 时，安装器使用旧版 MCP 路径，并将 Skill 放在 `~/.gemini/antigravity/skills/agent-handoff/`；以输出的实际文件位置为准。当前个人目录约定可参阅 [Antigravity MCP 文档](https://antigravity.google/docs/mcp)、[Antigravity Skills 文档](https://antigravity.google/docs/skills)、[Claude Code Skills 文档](https://code.claude.com/docs/en/skills)及 [Cursor Skills 文档](https://cursor.com/docs/skills)。

安装后重新加载 MCP 或重启客户端，再打开新对话。客户端可能要求启用服务、信任配置或允许工具调用。文件安装成功不等于已在所有客户端界面完成接入验证；请在自己使用的客户端确认能发现下文六个工具。

### 手动 JSON 配置

当自动安装不适用于当前环境时，把下面条目合并进已有的 `mcpServers`。默认数据目录可省略 `env`；自定义目录必须让各个客户端保持一致。

```json
{
  "mcpServers": {
    "agent-handoff": {
      "command": "npx",
      "args": ["-y", "agent-handoff-mcp@latest"],
      "env": {
        "HANDOFF_DIR": "C:/AgentData/handoff"
      }
    }
  }
}
```

如果客户端找不到 `npx`，填写它在本机的可执行文件绝对路径。需要固定版本时，将包参数改为 `agent-handoff-mcp@0.2.0`；`@latest` 使用 npm 的最新版本。

### Codex TOML 配置

将对应服务合并到 `~/.codex/config.toml`，不要重复添加已有同名表：

```toml
[mcp_servers.agent-handoff]
command = "npx"
args = ["-y", "agent-handoff-mcp@latest"]

[mcp_servers.agent-handoff.env]
HANDOFF_DIR = "C:/AgentData/handoff"
```

### Trae、WorkBuddy 与其他客户端

```bash
npx -y agent-handoff-mcp@latest init --target trae
npx -y agent-handoff-mcp@latest init --target workbuddy
```

这些目标输出 JSON，需用户在对应客户端的 MCP 设置中手动填写。安装器不承诺为其自动写入配置或安装 Skill。支持 Agent Skills 的客户端可按自己的规范安装仓库中的 [SKILL.md](https://github.com/648428732qq-sketch/agent-handoff-mcp/blob/main/SKILL.md)，或使用已有的等价交接规则。

## 目录、Obsidian 与跨设备

默认存储为 `~/.agent-handoff/`。通过 `init --dir` 选择其他目录，例如：

```bash
npx -y agent-handoff-mcp@latest init --dir "C:/notes/wiki-vault/_handoff"
```

`init --dir` 将目录写入客户端 MCP 配置，**不会**改变终端环境变量。终端中的后续 CLI 命令仍需传相同的 `--dir`，或设置 `HANDOFF_DIR`。目录选择优先级为 CLI `--dir`、进程环境变量 `HANDOFF_DIR`、默认目录。

```text
.agent-handoff/
├── index.md                 活跃主题目录
├── current.md               最近保存的指针
├── threads/
│   ├── 登录功能.md           一个主题的交接正文
│   └── rag-research.md       另一个主题的交接正文
└── _logs/
    └── agent-handoff.jsonl   诊断日志
```

正文含 Frontmatter，以及“当前目标”“已完成进展与关键文件”“关键决策与踩坑”“下一步行动”四节。主题名保留中文、字母、数字、`_` 和 `-`，其他字符转成 `-`。已有 `AGENTS.md`、`SHARED_AGENTS.md` 等协议时，让其中的目录约定与 MCP 设置一致。

Obsidian 可直接查看这些 Markdown，不需要额外插件。工具只管理交接摘要，不会自动导入或搜索 Vault 中的其他文章。跨设备需要自行提供复制、同步或共享目录，并协调写入时机；同一路径字符串不代表不同机器上的文件已经同步。

## CLI 查看、导出和关闭

以下命令使用默认目录。自定义目录时，给每条命令添加 `--dir "C:/AgentData/handoff"`：

```bash
npx -y agent-handoff-mcp@latest list
npx -y agent-handoff-mcp@latest list --project "voice-demo"
npx -y agent-handoff-mcp@latest load "登录功能"
npx -y agent-handoff-mcp@latest export "登录功能"
npx -y agent-handoff-mcp@latest close "登录功能" --archive "C:/AgentData/handoff-archive"
```

`export` 输出含交接正文的提示词，可以粘贴到网页版 AI。PowerShell 中可直接复制：

```powershell
npx -y agent-handoff-mcp@latest export "登录功能" | Set-Clipboard
```

CLI 处理已有主题；保存当前聊天由 Agent 调用 MCP `handoff_save` 完成。关闭时归档目录可选，未指定则删除活跃主题正文并更新索引。

## 诊断和反馈

```bash
npx -y agent-handoff-mcp@latest doctor
npx -y agent-handoff-mcp@latest report --lines 40
```

自定义目录时添加相同的 `--dir` 参数。`doctor` 显示运行环境、数据目录可写性、活跃主题数量和日志位置。`report` 输出 Markdown 环境报告、近期日志摘要和 GitHub Issue 链接。也可请已连接 MCP 的 Agent 调用 `handoff_diagnostics`。

日志位于 `<HANDOFF_DIR>/_logs/agent-handoff.jsonl`。在 MCP 服务的环境变量中设置 `HANDOFF_DEBUG=1`，可同时输出诊断信息到 stderr，供客户端排查；JSON 写成 `"HANDOFF_DEBUG": "1"`，TOML 环境表写成 `HANDOFF_DEBUG = "1"`。

报告会对部分路径和日志信息做摘要处理。提交到公开 Issue 前，请核对实际输出中的路径、环境信息和日志摘要，删去自己不希望公开的内容。

## MCP 接口

| 类型 | 名称 | 用途 |
|---|---|---|
| Tool | `handoff_list` | 列出活跃主题，可按项目过滤 |
| Tool | `handoff_load` | 加载指定主题或唯一匹配的主题 |
| Tool | `handoff_save` | 保存或更新一个主题 |
| Tool | `handoff_close` | 关闭主题，可先归档 |
| Tool | `handoff_export` | 生成供网页版 AI 使用的交接文本 |
| Tool | `handoff_diagnostics` | 环境、目录状态及近期日志摘要 |
| Prompt | `save`、`resume`、`list` | 引导保存、恢复和列出 |
| Resource | `handoff://index` | 提供轻量主题目录 |

Prompt 是否显示为斜杠命令，以及命令名称，由客户端决定。`handoff_save` 的参数示例：

```json
{
  "topic": "登录功能",
  "goal": "- 完成登录功能",
  "progress": "- 已完成接口参数校验",
  "decisions": "- 保留当前认证方案",
  "nextSteps": "- 验证登录后的跳转行为",
  "summary": "已完成参数校验，下一步验证跳转",
  "sourceAgent": "Agent A",
  "project": "web-demo",
  "workspace": "C:/work/web-demo"
}
```

Skill 引导 Agent 只在明确要求交接时保存；恢复时按主题加载，多候选先选择。四个支持自动安装的客户端，内置 Skill 会随 `init` 安装，无需再手动复制。需要定制规则时，可在了解冲突处理后维护自己的 Skill 或项目协议。

## 数据与使用边界

- 交接内容写入本机目录，运行无需独立远程服务器、数据库或 API Key。内容加载后进入当前 AI 客户端的上下文，按该客户端的数据设置处理。
- 不同对话使用不同主题；同名保存会更新对应文件，需要保留两个现场时使用不同名称。
- 保存触发与恢复选择由工具说明、Prompt、Skill 和客户端协作执行，存储层按工具参数读写。
- 当前单文件采用临时文件加重命名写入；多进程更新索引及最近指针尚无跨进程锁或完整事务保证。
- 关闭主题后，`current.md` 可能仍有旧指针；以 `handoff_list` 或 CLI `list` 的活跃结果判断可恢复内容。
- `npx` 首次使用需下载 npm 包和运行依赖。离线部署可先安装依赖并编译源码，再配置本地 `node` 入口。
- 本地个人配置与 Skill 不代表远程或云端 Agent 自动拥有相同文件；按客户端的远程设置配置和同步。

## 从源码构建

开发需要 Node.js 20 或以上、npm 和 Git：

```bash
git clone https://github.com/648428732qq-sketch/agent-handoff-mcp.git
cd agent-handoff-mcp
npm ci
npm run build
node dist/src/cli.js --help
npm test
```

使用源码部署时，将手动 MCP 配置的 `command` 改为 `node`，`args` 改为编译入口的绝对路径，例如 `["C:/work/agent-handoff-mcp/dist/src/cli.js"]`；保留同样的 `env`。终端示例中的 `npx -y agent-handoff-mcp@latest` 可替换为 `node dist/src/cli.js`，从仓库根目录运行。

项目使用 TypeScript：MCP 接口在 `src/server.ts`，CLI 在 `src/cli.ts`，安装逻辑在 `src/init.ts`，Markdown 存储在 `src/store.ts`，存储抽象在 `src/types.ts`。`npm test` 先编译再运行测试；CI 覆盖 Windows、Linux 的 Node.js 20／22，本机验证使用 Node.js 24。自动化测试与 stdio 联通检查不等同于所有客户端界面的完整接入测试。

## 提交问题和贡献代码

通过 [Bug 表单](https://github.com/648428732qq-sketch/agent-handoff-mcp/issues/new?template=bug_report.yml)或[功能建议](https://github.com/648428732qq-sketch/agent-handoff-mcp/issues/new?template=feature_request.yml)反馈。先看[已有 Issues](https://github.com/648428732qq-sketch/agent-handoff-mcp/issues)，再写明客户端、系统、Node.js 版本、复现步骤、预期与实际结果；能运行诊断时可附核对过的报告，安装失败时直接描述错误即可。

仓库开放 Issues 和 Fork。登录自己的 GitHub 账号后：

1. [Fork 本项目](https://github.com/648428732qq-sketch/agent-handoff-mcp/fork)，创建个人副本。
2. 将下面的 `YOUR_USERNAME` 换成自己的用户名，新建分支。

```bash
git clone https://github.com/YOUR_USERNAME/agent-handoff-mcp.git
cd agent-handoff-mcp
git switch -c fix/describe-change
npm ci
```

3. 完成修改、验证后，提交并推送到自己的 Fork。

```bash
npm test
git add .
git commit -m "fix: describe your change"
git push -u origin fix/describe-change
```

4. 打开[提交 PR](https://github.com/648428732qq-sketch/agent-handoff-mcp/compare)，选择 “compare across forks”。目标为 `648428732qq-sketch/agent-handoff-mcp` 的 `main`，来源为个人 Fork 的修改分支。
5. 描述问题、修改后的行为和验证结果；关联已有 Issue 可写 `关联 #编号`。维护者审核后合并，后续调整继续推送同一分支。

[MIT License](https://github.com/648428732qq-sketch/agent-handoff-mcp/blob/main/LICENSE)
