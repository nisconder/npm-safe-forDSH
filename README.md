# npm-safe-dsh

将本地 npm 供应链安全引擎 **`@npm-safe/core`** 迁移到 **DeepSeek Harness (dsh)** 生态的工具插件仓库。目标形态是：AI 智能体在 dsh 会话中直接调用包安全扫描工具，作为「安装前先检查」的安全门禁。引擎能力（包检查、搜索、监视、刷新、规则管理、设置、CI 门禁扫描等）全部映射为 dsh 工具，共 14 个。

本仓库为 pnpm workspace monorepo，计划包含两个包：

- `packages/core`：迁入的 `@npm-safe/core` 引擎（静态分析 + LLM 扫描 + SQLite 缓存 + 速率限制），已剔除 CLI / 桌面端 / telemetry 等非工具形态产物。
- `packages/tool-npm-safe`：dsh 工具插件 `@npm-safe/dsh-tool-npm-safe`（计划中）。

## 当前状态

| 里程碑 | 状态 |
|---|---|
| **Session 1**（2026-08-19）：Phase 0-2，T1-T8。仓库骨架、core 源码迁入、依赖精简、测试迁移到 vitest、引擎重构（forceRefresh/signal 透传、`ciScan` 移植）。共 13 个提交，HEAD `2698df3`。 | ✅ 完成（18 个测试文件 / 252 用例全绿，typecheck 通过，LSP 无错误） |
| **Session 2**（未定）：Phase 3-5，T9-T14 + F1-F4。插件包开发（14 个工具 + 后台 `refresh_all`）、README/LICENSE/CI/冒烟脚本终验、RC 版本审计、最终验证波。 | ⏳ 延后 |

当前仓库仅含 `packages/core`；插件包 `packages/tool-npm-safe` 尚未创建。

## 仓库结构

```
npm-safe-dsh/
├── package.json               # 私有根包：pnpm@11.7.0 锁定、聚合脚本
├── pnpm-workspace.yaml        # workspace = packages/*；better-sqlite3 构建放行
├── pnpm-lock.yaml             # 依赖锁文件（已提交）
├── tsconfig.base.json         # 共享 TS 配置
├── .npmrc                     # only-built-dependencies[]=better-sqlite3
├── .gitignore / .env.example
├── docs/
│   ├── npm-safe-dsh-plugin-migration.md   # 迁移实施规范（权威）
│   └── HANDOVER.md                        # 交接文档（当前进展 / 任务进度 / 继续开发指引）
└── packages/
    └── core/                  # @npm-safe/core 引擎
        ├── src/               # index.ts 门面 + registry/scanner/store/scheduler/llm/translator
        ├── test/              # vitest 测试（不含网络依赖）
        └── API.md / ARCHITECTURE.md / SCANNER_RULES.md
```

## 快速开始

**环境要求**：Node.js ≥ 22.19（或 24+，本机验证为 v24.18.0）、Git ≥ 2.26、pnpm 11.7.0（经 Corepack 管理）、可访问 npm registry。

```sh
# 1) 激活 Corepack 并锁定 pnpm 版本
corepack enable
corepack prepare pnpm@11.7.0 --activate
pnpm --version            # 应输出 11.7.0

# 2) 安装依赖
pnpm install
```

> **better-sqlite3 构建放行**：better-sqlite3 是原生模块，pnpm 11 默认拦截其构建脚本。本仓库已在 `pnpm-workspace.yaml`（`pnpm.onlyBuiltDependencies` 与 `allowBuilds`）和 `.npmrc`（`only-built-dependencies[]=better-sqlite3`）中配置放行。注意 pnpm 11 不再读取 `package.json` 的 `pnpm` 字段；若仍被拦截，执行 `pnpm approve-builds` 并选择 better-sqlite3。

**静态验证**（顺序重要：先 build 产出 `packages/core/dist`，后续插件才能解析 `@npm-safe/core`）：

```sh
pnpm run build            # 构建 core，产出 packages/core/dist
pnpm run typecheck
pnpm run test

# 或仅对 core 包执行
pnpm --filter @npm-safe/core build
pnpm --filter @npm-safe/core typecheck
pnpm --filter @npm-safe/core test
```

## 计划工具清单（Session 2 实现）

插件将提供以下 14 个 dsh 工具：

| 工具 | 用途 | 执行形态 |
|---|---|---|
| `check_package` | 检查单个包 | 前台（转发取消信号） |
| `check_packages` | 批量检查 | 前台（内部限流） |
| `search_packages` | 关键词搜索 | 前台 |
| `watch_add` / `watch_remove` / `watch_list` | 监视列表 | 前台 |
| `rules_list` / `rule_enable` / `rule_disable` / `rule_set_severity` | 规则管理 | 前台 |
| `settings_get` / `settings_set` | 引擎设置 | 前台 |
| `ci_scan` | 依赖门禁扫描 | 前台 |
| `refresh_all` | 刷新全部监视包 | 后台任务（`ctx.jobs.start`） |

## 引擎状态文件

引擎运行时会在仓库根目录创建 `./npm-safe.db`（SQLite 缓存），并在用户目录创建 `~/.npm-safe/`（LLM / 规则配置）。两者均已在 `.gitignore` 中忽略，不会入库。

## 手动 dsh 验证（延后）

Web UI 与 headless 端到端验证是**手动步骤**，留待插件创建（Session 2）之后执行，当前不可运行。需要先安装 dsh CLI 并配置 API key：

```sh
pnpm add -g @deepseek-ai/dsh@0.1.0-rc.6
# 并在仓库根目录 .env 中配置 DEEPSEEK_API_KEY
```

届时通过 `pnpm dsh web --patch ./packages/tool-npm-safe/cordis.patch.yml`（Web UI）或 `pnpm dsh --profile headless "check lodash"`（headless）验证 `check_package` 工具。

## 更多文档

- `docs/HANDOVER.md`：交接文档，含当前状态、任务进度跟踪、关键技术决策、继续开发指引与已知注意事项。
- `docs/npm-safe-dsh-plugin-migration.md`：迁移实施规范（权威），描述引擎迁入与插件实现的完整方案。
