<div align="center">

# npm-safe-forDSH
**面向 DeepSeek Harness 的 npm 供应链安全**

[![Version](https://img.shields.io/badge/version-0.1.0-2196F3)](https://github.com/nisconder/npm-safe-forDSH/releases)
[![License](https://img.shields.io/badge/license-Apache--2.0-4CAF50)](./LICENSE)
![Language](https://img.shields.io/badge/Language-TypeScript-3178C6?logo=typescript&logoColor=white)
[![CI](https://img.shields.io/github/actions/workflow/status/nisconder/npm-safe-forDSH/ci.yml?branch=main&label=CI)](https://github.com/nisconder/npm-safe-forDSH/actions)
[![Node](https://img.shields.io/badge/Node.js-22.19%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![pnpm](https://img.shields.io/badge/pnpm-11.7.0-F69220?logo=pnpm&logoColor=white)](https://pnpm.io)

[English](README.md) · **中文版**

</div>

---
`npm-safe-forDSH` 将本地优先的 npm 供应链安全引擎 **`@npm-safe/core`**
重新架构为 **DeepSeek Harness（dsh）工具插件**。AI 智能体可以在会话中直接调用
包安全扫描，作为「安装前先检查」的安全门禁。引擎的完整能力——检查、搜索、监视、
刷新、规则、设置与 CI 门禁扫描——被映射为 **14 个 dsh 工具**，含后台
`refresh_all` 任务。

## 原仓库 / Original repository

- 本仓库：https://github.com/nisconder/npm-safe-forDSH
- 引擎原仓库（`@npm-safe/core` 源码来源，只读参考）：https://github.com/nisconder/npm-safe
- dsh 平台（DeepSeek Harness）：https://github.com/deepseek-ai/deepseek-harness

## 快速开始

要求 Node.js 22.19 及以上、pnpm 11.7.0（经 Corepack 管理）。

```bash
corepack enable
corepack prepare pnpm@11.7.0 --activate
pnpm install
```

> **better-sqlite3 构建放行**：`better-sqlite3` 是原生模块，pnpm 11 默认拦截其
> 构建脚本。放行已配置于 `pnpm-workspace.yaml`（`pnpm.onlyBuiltDependencies` /
> `allowBuilds`）与 `.npmrc`（`only-built-dependencies[]=better-sqlite3`）。
> 若仍被拦截，执行 `pnpm approve-builds` 并选择 `better-sqlite3`。

**静态验证**（先 build，插件才能解析 `packages/core/dist`）：

```bash
pnpm run build
pnpm run typecheck
pnpm run test
```

**一次性冒烟验证**（需联网——请求真实 npm registry）：

```bash
node scripts/smoke.mjs lodash                  # 打印等级 / 评分 / 发现数
node scripts/smoke.mjs definitely-not-real-xyz # 不存在的包 → exists:false
node scripts/smoke-facade.mjs                  # watchlist / settings / ciScan
```

---
## 工具

`@npm-safe/dsh-tool-npm-safe` 插件在 dsh 会话中注册以下工具：

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

## 架构

pnpm workspace monorepo，包含两个包：

```
npm-safe-forDSH/
├── package.json                 # 私有根包：pnpm@11.7.0、聚合脚本
├── pnpm-workspace.yaml          # workspace = packages/*；better-sqlite3 放行
├── tsconfig.base.json           # 共享严格 TS 配置
├── .npmrc                       # only-built-dependencies[]=better-sqlite3
├── .github/workflows/ci.yml     # Node 22.19 + 24 矩阵：build → typecheck → test
├── scripts/
│   ├── smoke.mjs                # checkPackage 冒烟（真实触网）
│   └── smoke-facade.mjs         # watchlist / settings / ciScan 冒烟
└── packages/
    ├── core/                    # @npm-safe/core 引擎（已剔除 CLI/桌面端/telemetry）
    └── tool-npm-safe/           # @npm-safe/dsh-tool-npm-safe 插件（14 个工具）
```

## CI

`.github/workflows/ci.yml` 在每次 push / PR 时运行：Node 22.19 与 24 矩阵、
启用 Corepack、`pnpm install` → `pnpm --filter @npm-safe/core run build` →
`pnpm run typecheck` → `pnpm run test`。

## 手动 dsh 验证

在 dsh（Web UI / headless）中的端到端验证为手动步骤。需安装 dsh CLI 并配置 API key：

```bash
pnpm add -g @deepseek-ai/dsh@0.1.0-rc.6
# 在仓库根目录 .env 中配置 DEEPSEEK_API_KEY
```

随后验证 `check_package` 工具：

```bash
pnpm dsh web --patch ./packages/tool-npm-safe/cordis.patch.yml
# Web UI：打开 http://127.0.0.1:3080，提问 "check lodash"

pnpm dsh --profile headless "check lodash"
```

> 全部 dsh 包锁定同一 RC 版本族（`0.1.0-rc.6`，cordis `^4.0.1`）。
> 升级时必须全仓对齐。

## 更多文档

- [packages/core/API.md](packages/core/API.md) — 引擎 API 参考
- [packages/core/ARCHITECTURE.md](packages/core/ARCHITECTURE.md) — 引擎架构
- [packages/core/SCANNER_RULES.md](packages/core/SCANNER_RULES.md) — 扫描规则参考

## 许可证

[Apache-2.0](LICENSE) — Copyright 2026 Nisconder, InfiniteScope, Escap1ng, StoryBegins.
