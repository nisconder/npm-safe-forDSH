<div align="center">

# npm-safe-forDSH
**npm Supply-Chain Security for DeepSeek Harness**

[![Version](https://img.shields.io/badge/version-0.1.0-2196F3)](https://github.com/nisconder/npm-safe-forDSH/releases)
[![License](https://img.shields.io/badge/license-Apache--2.0-4CAF50)](./LICENSE)
![Language](https://img.shields.io/badge/Language-TypeScript-3178C6?logo=typescript&logoColor=white)
[![CI](https://img.shields.io/github/actions/workflow/status/nisconder/npm-safe-forDSH/ci.yml?branch=main&label=CI)](https://github.com/nisconder/npm-safe-forDSH/actions)
[![Node](https://img.shields.io/badge/Node.js-22.19%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![pnpm](https://img.shields.io/badge/pnpm-11.7.0-F69220?logo=pnpm&logoColor=white)](https://pnpm.io)

[中文版](README_zh.md) · **English**

</div>

---
`npm-safe-forDSH` re-architects the local-first npm supply-chain security engine
**`@npm-safe/core`** as a **DeepSeek Harness (dsh) tool plugin**. AI agents can
call package security scans directly inside a conversation, acting as a
"check before you install" gate. The engine's full capability — checking,
search, watchlist, refresh, rules, settings, and CI gate scans — is mapped to
**14 dsh tools**, including a background `refresh_all` job.

## 原仓库 / Original repository

- 本仓库：https://github.com/nisconder/npm-safe-forDSH
- 引擎原仓库（`@npm-safe/core` 源码来源，只读参考）：https://github.com/nisconder/npm-safe
- dsh 平台（DeepSeek Harness）：https://github.com/deepseek-ai/deepseek-harness

## Quick Start

Requires Node.js 22.19 or later and pnpm 11.7.0 (via Corepack).

```bash
corepack enable
corepack prepare pnpm@11.7.0 --activate
pnpm install
```

> **better-sqlite3 build allowlist**: `better-sqlite3` is a native module and
> pnpm 11 blocks its build scripts by default. Allowlist is configured in
> `pnpm-workspace.yaml` (`pnpm.onlyBuiltDependencies` / `allowBuilds`) and
> `.npmrc` (`only-built-dependencies[]=better-sqlite3`). If still blocked, run
> `pnpm approve-builds` and select `better-sqlite3`.

**Static verification** (build first so the plugin can resolve
`packages/core/dist`):

```bash
pnpm run build
pnpm run typecheck
pnpm run test
```

**One-shot smoke tests** (network required — hits the live npm registry):

```bash
node scripts/smoke.mjs lodash                  # prints level / score / findings
node scripts/smoke.mjs definitely-not-real-xyz # missing package → exists:false
node scripts/smoke-facade.mjs                  # watchlist / settings / ciScan
```

---
## Tools

The `@npm-safe/dsh-tool-npm-safe` plugin registers the following tools in a
dsh session:

| Tool | Purpose | Execution |
|---|---|---|
| `check_package` | Check a single package | Foreground (signal-forwarded) |
| `check_packages` | Check many packages | Foreground (rate-limited) |
| `search_packages` | Keyword search of the registry | Foreground |
| `watch_add` / `watch_remove` / `watch_list` | Watchlist management | Foreground |
| `rules_list` / `rule_enable` / `rule_disable` / `rule_set_severity` | Rule management | Foreground |
| `settings_get` / `settings_set` | Engine settings | Foreground |
| `ci_scan` | Dependency gate scan | Foreground |
| `refresh_all` | Refresh the watchlist | Background (`ctx.jobs.start`) |

## Architecture

A pnpm workspace monorepo with two packages:

```
npm-safe-forDSH/
├── package.json                 # Private root: pnpm@11.7.0, aggregate scripts
├── pnpm-workspace.yaml          # workspace = packages/*; better-sqlite3 allowlist
├── tsconfig.base.json           # Shared strict TS config
├── .npmrc                       # only-built-dependencies[]=better-sqlite3
├── .github/workflows/ci.yml     # Node 22.19 + 24 matrix: build → typecheck → test
├── scripts/
│   ├── smoke.mjs                # checkPackage smoke (live registry)
│   └── smoke-facade.mjs         # watchlist / settings / ciScan smoke
└── packages/
    ├── core/                    # @npm-safe/core engine (CLI/desktop/telemetry stripped)
    └── tool-npm-safe/           # @npm-safe/dsh-tool-npm-safe plugin (14 tools)
```

## CI

`.github/workflows/ci.yml` runs on every push / PR: Node 22.19 and 24 matrix,
Corepack enabled, `pnpm install` → `pnpm run build` →
`pnpm run typecheck` → `pnpm run test`.

## Manual dsh Verification

End-to-end verification in dsh (Web UI / headless) needs the dsh CLI and an API
key. **The plugin is not published to npm yet**, so `cordis.patch.yml` — which
names `@npm-safe/dsh-tool-npm-safe` — cannot be resolved until it is published.
For local verification, mount the plugin source directly with a temporary patch.

Configure the API key in a root `.env` file:

```bash
# DEEPSEEK_API_KEY=sk-...
```

Create a temporary local patch at the repo root (replace `<abs>` with the repo's
absolute path):

```yaml
# local.patch.yml
- insert:
    - id: tool-npm-safe
      name: 'file://<abs>/packages/tool-npm-safe/src/index.ts'
```

Run headless (verified working on `0.1.0-rc.6`):

```bash
pnpm dlx @deepseek-ai/dsh@0.1.0-rc.6 --profile headless \
  --patch ./local.patch.yml \
  "Use the check_package tool to check lodash"
```

Once the plugin is published, `cordis.patch.yml` can be used directly:

```bash
pnpm dsh web --patch ./packages/tool-npm-safe/cordis.patch.yml
pnpm dsh --profile headless "check lodash"
```

> All dsh packages are pinned to the same RC family (`0.1.0-rc.6`, cordis
> `^4.0.1`). Upgrades must stay aligned across the whole repo.

## Documentation

- [packages/core/API.md](packages/core/API.md) — engine API reference
- [packages/core/ARCHITECTURE.md](packages/core/ARCHITECTURE.md) — engine architecture
- [packages/core/SCANNER_RULES.md](packages/core/SCANNER_RULES.md) — scanner rules reference

## License

[Apache-2.0](LICENSE) — Copyright 2026 Nisconder, InfiniteScope, Escap1ng, StoryBegins.
