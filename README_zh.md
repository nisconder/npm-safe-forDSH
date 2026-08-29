<div align="center">

# npm-safe for DeepSeek Harness

**在 AI 智能体安装危险 npm 包之前拦住它。**

[![npm](https://img.shields.io/npm/v/@npm-safe/dsh-tool-npm-safe?logo=npm&color=CB3837)](https://www.npmjs.com/package/@npm-safe/dsh-tool-npm-safe)
[![downloads](https://img.shields.io/npm/dm/@npm-safe/dsh-tool-npm-safe?logo=npm)](https://www.npmjs.com/package/@npm-safe/dsh-tool-npm-safe)
[![CI](https://img.shields.io/github/actions/workflow/status/nisconder/npm-safe-forDSH/ci.yml?branch=main&label=CI)](https://github.com/nisconder/npm-safe-forDSH/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-Apache--2.0-4CAF50)](LICENSE)
[![Node](https://img.shields.io/badge/Node.js-22.19%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org)

**14 个智能体工具 · 22 项安全检查 · 完整性验证深度扫描 · 本地 SQLite 缓存**

[安装](#30-秒安装) · [检测内容](#能检测什么) · [工具目录](#14-个智能体工具) · [English](README.md)

</div>

`npm-safe-forDSH` 是面向
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的 npm
供应链安全门禁。它让智能体在安装之前检查包元数据和已发布 tarball，并在同一段
会话里返回证据、风险等级和可解释评分。

> 如果它让你的智能体工作流更安全，请为仓库点一个 **Star**。这会帮助其他 DSH
> 用户发现这个独立安全工具。

## 30 秒安装

```bash
dsh plugin --profile tui add @npm-safe/dsh-tool-npm-safe --allow-build=better-sqlite3
dsh --profile tui
```

安装后请重启正在运行的 profile，然后直接提问：

```text
安装 fast-glob 前先做深度扫描，并解释每一项发现。
```

只做快速元数据检查：

```text
使用 check_package 检查 lodash。
```

插件已声明为原生 DSH bundle，因此官方 `dsh plugin` 命令会同时安装包并启用
`cordis.patch.yml` 层。`--allow-build=better-sqlite3` 只允许本地缓存所用的 SQLite
驱动执行构建脚本，pnpm 仍会拦截其他依赖的安装脚本。请先在 DSH 中配置你选择的
模型提供方；只有选择 DeepSeek 作为提供方时才需要 DeepSeek API Key。

## 能检测什么

| 信号 | 元数据扫描 | 深度扫描 |
|---|:---:|:---:|
| 可疑生命周期脚本和安装钩子 | ✅ | ✅ |
| 拼写仿冒、废弃包和高风险维护者 | ✅ | ✅ |
| 非标准 registry 和远程二进制文件 | ✅ | ✅ |
| Tarball 完整性不匹配和危险归档路径 | — | ✅ |
| 混淆代码、嵌入密钥、Shell/网络执行 | — | ✅ |
| 原生二进制、WebAssembly、超限或截断内容 | — | ✅ |

元数据扫描速度快，因此保持为默认模式。设置 `deep: true` 后，插件会下载同源的
已发布 tarball、校验 npm 完整性元数据，并完全在内存中按严格边界检查源码。

```text
package: fast-glob@3.3.3
level: safe
score: 88/100
integrity: verified
files scanned: 91
findings: 1 low, 0 medium, 0 high, 0 critical
```

## 为什么放进智能体

| 普通智能体流程 | 使用 npm-safe-forDSH |
|---|---|
| 先安装，出问题后再审计 | 在做出安装决定前检查 |
| 只相信包名和下载量 | 检查维护者、脚本、来源信号和实际内容 |
| 只返回缺少上下文的通过/失败 | 返回证据、严重性、评分与建议 |
| 重复请求 registry | 使用本地 SQLite 缓存和限流 |
| 每次手动检查一个包 | 支持批量、监视列表、后台刷新和 CI 门禁 |

## 14 个智能体工具

| 工具 | 用途 |
|---|---|
| `check_package` | 检查单个包，可选 `deep: true` |
| `check_packages` | 限流批量检查 |
| `search_packages` | 搜索 npm registry |
| `watch_add` / `watch_remove` / `watch_list` | 管理持久监视列表 |
| `rules_list` / `rule_enable` / `rule_disable` | 查看并启停规则 |
| `rule_set_severity` | 覆盖规则严重性 |
| `settings_get` / `settings_set` | 读取或更新引擎设置 |
| `ci_scan` | 将项目依赖扫描作为安全门禁 |
| `refresh_all` | 以 DSH 后台任务刷新监视列表 |

## 安全模型

- 核心检测是确定性的、本地优先的；默认不会把包源码发送给外部 LLM。
- 深度扫描拒绝跨域 tarball，并限制归档大小、文件数、解压量、路径与文本扫描量。
- 检测结果是安全证据，不是绝对安全保证。生产环境仍应人工复核高影响依赖并锁定版本。
- 查看完整的[扫描规则](packages/core/SCANNER_RULES.md)和[安全策略](SECURITY.md)。

## 直接使用引擎

```bash
pnpm add @npm-safe/core-dsh
```

```ts
import { NpmSafeEngine } from "@npm-safe/core-dsh";

const engine = new NpmSafeEngine();
const report = await engine.checkPackage("lodash", { deep: true });
console.log(report.level, report.score, report.findings);
await engine.close();
```

## 从源码开发

要求 Node.js 22.19+ 与 Corepack。

```bash
git clone https://github.com/nisconder/npm-safe-forDSH.git
cd npm-safe-forDSH
corepack enable
corepack prepare pnpm@11.7.0 --activate
pnpm install
pnpm run build
pnpm run typecheck
pnpm run test
```

真实 npm registry 冒烟测试：

```bash
node scripts/smoke.mjs lodash
node scripts/smoke-facade.mjs
```

工作区包含 [`@npm-safe/core-dsh`](packages/core) 和
[`@npm-safe/dsh-tool-npm-safe`](packages/tool-npm-safe) bundle。DSH peer 包与
`0.1.0-rc.6` 版本族对齐；DeepSeek Harness 仍处于开发者预览阶段，升级时必须保持
全仓版本一致。

## 文档

- [插件包与示例](packages/tool-npm-safe/README.md)
- [引擎 API](packages/core/API.md)
- [架构](packages/core/ARCHITECTURE.md)
- [扫描规则](packages/core/SCANNER_RULES.md)
- [贡献指南](CONTRIBUTING.md)

本项目将 [`nisconder/npm-safe`](https://github.com/nisconder/npm-safe) 引擎适配到
DeepSeek Harness。它是独立社区项目，与 DeepSeek 没有关联，也未获得其官方背书。

## 许可证

[Apache-2.0](LICENSE) — Copyright 2026 Nisconder, InfiniteScope, Escap1ng, StoryBegins.
