<p align="center">
  <a href="README.md">English</a> · <a href="README.zh-CN.md">中文</a>
</p>

<br>

<p align="center">
  <img src="https://img.shields.io/github/actions/workflow/status/nisconder/npm-safe-forDSH/ci.yml?logo=githubactions&logoColor=white&label=CI&style=for-the-badge" alt="CI 状态" />
  <img src="https://img.shields.io/github/license/nisconder/npm-safe-forDSH?logo=apache&style=for-the-badge" alt="许可证" />
  <img src="https://img.shields.io/badge/Node.js-%3E%3D22.19-5FA04E?logo=nodedotjs&logoColor=white&style=for-the-badge" alt="Node.js >= 22.19" />
  <img src="https://img.shields.io/badge/pnpm-11.7.0-F69220?logo=pnpm&logoColor=white&style=for-the-badge" alt="pnpm 11.7.0" />
  <img src="https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white&style=for-the-badge" alt="TypeScript strict" />
</p>

<h1 align="center">npm-safe-dsh</h1>

<p align="center">
  <b>按需供应链安全（Supply-chain security, on demand）。</b><br>
  将 <code>@npm-safe/core</code> 引擎重新架构为 DeepSeek Harness（dsh）工具插件——<br>
  让 AI 智能体把每一次「安装」都置于安全扫描门禁之后。
</p>

<br>

## 项目概览

`npm-safe-dsh` 将本地优先的 npm 供应链安全引擎 **`@npm-safe/core`**
（静态分析 · LLM 扫描 · SQLite 缓存 · 速率限制）迁移到 **DeepSeek Harness（dsh）** 生态。
引擎的完整能力——包检查、搜索、监视、刷新、规则管理、设置与 CI 门禁扫描——
以 **14 个 dsh 工具** 的形式对外暴露，使 AI 智能体可以在会话中直接执行
「安装前先检查」的安全门禁。

本仓库为 pnpm workspace monorepo，包含两个包：

| 包 | 作用 |
|---|---|
| `packages/core` | 迁入的 `@npm-safe/core` 引擎——已剔除 CLI / 桌面端 / telemetry，含门面 + registry + scanner + store + scheduler + llm + translator |
| `packages/tool-npm-safe` | `@npm-safe/dsh-tool-npm-safe` 插件——14 个 dsh 工具（含后台 `refresh_all`） |

## 特性

- **14 个 dsh 工具** — 引擎完整能力映射为原生工具调用
- **后台任务** — `refresh_all` 经 `ctx.jobs.start` 运行，支持协作式取消
- **安装门禁** — `ci_scan` 可在可配置的严重级别上使构建失败
- **本地优先** — SQLite 缓存 + `~/.npm-safe` 配置，重复检查无需强制联网
- **类型安全** — 严格 TypeScript，工具参数由 schema 推断
- **零接触测试** — 引擎 stub 的工具测试 + 252 个引擎测试，全部离线

## 工具清单

| 工具 | 用途 | 执行形态 |
|---|---|---|
| `check_package` | 检查单个包 | 前台（转发取消信号） |
| `check_packages` | 批量检查 | 前台（内部限流） |
| `search_packages` | 关键词搜索注册表 | 前台 |
| `watch_add` / `watch_remove` / `watch_list` | 监视列表管理 | 前台 |
| `rules_list` / `rule_enable` / `rule_disable` / `rule_set_severity` | 规则管理 | 前台 |
| `settings_get` / `settings_set` | 引擎设置 | 前台 |
| `ci_scan` | 依赖门禁扫描 | 前台 |
| `refresh_all` | 刷新全部监视包 | 后台（`ctx.jobs.start`） |

## 仓库结构

```
npm-safe-dsh/
├── package.json                 # 私有根包：pnpm@11.7.0、聚合脚本
├── pnpm-workspace.yaml          # workspace = packages/*；better-sqlite3 构建放行
├── tsconfig.base.json           # 共享严格 TS 配置
├── .npmrc                       # only-built-dependencies[]=better-sqlite3
├── LICENSE                      # Apache-2.0
├── .github/workflows/ci.yml     # Node 22.19 + 24 矩阵：build → typecheck → test
├── docs/
│   ├── npm-safe-dsh-plugin-migration.md   # 迁移实施规范（权威）
│   └── HANDOVER.md                        # 交接文档：状态 / 进度 / 决策
├── scripts/
│   ├── smoke.mjs                # checkPackage 冒烟（真实触网）
│   └── smoke-facade.mjs         # watchlist / settings / ciScan 冒烟（真实触网）
└── packages/
    ├── core/                    # @npm-safe/core 引擎
    │   ├── src/                 # index.ts 门面 + registry/scanner/store/scheduler/llm/translator
    │   ├── test/                # vitest 测试（离线）
    │   └── API.md / ARCHITECTURE.md / SCANNER_RULES.md
    └── tool-npm-safe/           # @npm-safe/dsh-tool-npm-safe 插件
        ├── src/index.ts         # apply / inject + 14 个工具定义
        ├── cordis.yml / cordis.patch.yml
        └── test/                # 工具级测试（引擎 stub，离线）
```

## 快速开始

**环境要求**：Node.js ≥ 22.19（或 24+，本机验证为 v24.18.0）、Git ≥ 2.26、
pnpm 11.7.0（经 Corepack 管理）、可访问 npm registry。

```sh
# 1) 激活 Corepack 并锁定 pnpm 版本
corepack enable
corepack prepare pnpm@11.7.0 --activate
pnpm --version            # 应输出 11.7.0

# 2) 安装依赖
pnpm install
```

> **better-sqlite3 构建放行**：`better-sqlite3` 是原生模块，pnpm 11 默认拦截其
> 构建脚本。放行已配置于 `pnpm-workspace.yaml`（`pnpm.onlyBuiltDependencies` /
> `allowBuilds`）与 `.npmrc`（`only-built-dependencies[]=better-sqlite3`）。
> 若仍被拦截，执行 `pnpm approve-builds` 并选择 `better-sqlite3`。

**静态验证**（顺序重要：先 build 产出 `packages/core/dist`，插件才能解析）：

```sh
pnpm run build            # 构建 core → packages/core/dist
pnpm run typecheck
pnpm run test
```

**一次性冒烟验证**（需联网——请求真实 npm registry）：

```sh
node scripts/smoke.mjs lodash                  # 打印等级 / 评分 / 发现数
node scripts/smoke.mjs definitely-not-real-xyz # 不存在的包 → exists:false
node scripts/smoke-facade.mjs                  # watchlist / settings / ciScan
```

## CI

`.github/workflows/ci.yml` 在每次 push / PR 时运行：Node 22.19 与 24 矩阵、
启用 Corepack、`pnpm install` → `pnpm --filter @npm-safe/core run build` →
`pnpm run typecheck` → `pnpm run test`。

## 手动 dsh 验证

在 dsh（Web UI / headless）中的端到端验证为手动步骤。需安装 dsh CLI 并配置 API key：

```sh
pnpm add -g @deepseek-ai/dsh@0.1.0-rc.6
# 或免全局安装：
# npx @deepseek-ai/dsh@0.1.0-rc.6 web --patch ./packages/tool-npm-safe/cordis.patch.yml

# 在仓库根目录 .env 中配置 DEEPSEEK_API_KEY
```

随后验证 `check_package` 工具：

```sh
# Web UI：打开 http://127.0.0.1:3080，提问 "Use the check_package tool to check lodash"
pnpm dsh web --patch ./packages/tool-npm-safe/cordis.patch.yml

# headless：
pnpm dsh --profile headless "check lodash"
```

> 全部 dsh 包锁定同一 RC 版本族（`0.1.0-rc.6`，cordis `^4.0.1`）。
> 升级时必须全仓对齐。

## 更多文档

- [HANDOVER.md](docs/HANDOVER.md) — 状态、任务进度、关键技术决策、已知注意事项
- [npm-safe-dsh-plugin-migration.md](docs/npm-safe-dsh-plugin-migration.md) — 迁移实施规范（权威）
- `packages/core/API.md` · `ARCHITECTURE.md` · `SCANNER_RULES.md` — 引擎参考

## 许可证

[Apache-2.0](LICENSE) — Copyright 2026 Nisconder, InfiniteScope, Escap1ng, StoryBegins.
