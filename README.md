<p align="center">
  <a href="README.md">English</a> · <a href="README.zh-CN.md">中文</a>
</p>

<br>

<p align="center">
  <img src="https://img.shields.io/github/actions/workflow/status/nisconder/npm-safe-forDSH/ci.yml?logo=githubactions&logoColor=white&label=CI&style=for-the-badge" alt="CI status" />
  <img src="https://img.shields.io/github/license/nisconder/npm-safe-forDSH?logo=apache&style=for-the-badge" alt="License" />
  <img src="https://img.shields.io/badge/Node.js-%3E%3D22.19-5FA04E?logo=nodedotjs&logoColor=white&style=for-the-badge" alt="Node.js >= 22.19" />
  <img src="https://img.shields.io/badge/pnpm-11.7.0-F69220?logo=pnpm&logoColor=white&style=for-the-badge" alt="pnpm 11.7.0" />
  <img src="https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white&style=for-the-badge" alt="TypeScript strict" />
</p>

<h1 align="center">npm-safe-dsh</h1>

<p align="center">
  <b>Supply-chain security, on demand.</b><br>
  The <code>@npm-safe/core</code> engine, re-architected as a DeepSeek Harness (dsh)
  tool plugin — so AI agents can gate every <i>install</i> behind a security scan.
</p>

<br>

## Overview

`npm-safe-dsh` migrates the local-first npm supply-chain security engine
**`@npm-safe/core`** (static analysis · LLM scanning · SQLite cache · rate limiting)
into the **DeepSeek Harness (dsh)** ecosystem. The engine's full capability —
package checking, search, watchlist, refresh, rule management, settings, and CI
gate scans — is exposed as **14 dsh tools**, letting an AI agent run
"check before you install" gates directly inside a conversation.

The repository is a pnpm workspace monorepo with two packages:

| Package | Role |
|---|---|
| `packages/core` | The migrated `@npm-safe/core` engine — CLI / desktop / telemetry stripped, facade + registry + scanner + store + scheduler + llm + translator |
| `packages/tool-npm-safe` | The `@npm-safe/dsh-tool-npm-safe` plugin — 14 dsh tools incl. background `refresh_all` |

## Features

- **14 dsh tools** — full engine surface mapped to native tool calls
- **Background jobs** — `refresh_all` runs via `ctx.jobs.start` with cooperative cancellation
- **Install-time gate** — `ci_scan` fails the build at a configurable severity level
- **Local-first** — SQLite cache + `~/.npm-safe` config, no mandatory network for repeat checks
- **Type-safe** — strict TypeScript, schema-inferred tool arguments
- **Zero-touch tests** — engine-stubbed tool tests, 252 engine tests, all network-free

## Tool Suite

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

## Repository Layout

```
npm-safe-dsh/
├── package.json                 # Private root: pnpm@11.7.0, aggregate scripts
├── pnpm-workspace.yaml          # workspace = packages/*; better-sqlite3 build allowlist
├── tsconfig.base.json           # Shared strict TS config
├── .npmrc                       # only-built-dependencies[]=better-sqlite3
├── LICENSE                      # Apache-2.0
├── .github/workflows/ci.yml     # Node 22.19 + 24 matrix: build → typecheck → test
├── docs/
│   ├── npm-safe-dsh-plugin-migration.md   # Migration spec (authoritative)
│   └── HANDOVER.md                        # Handover doc: status, progress, decisions
├── scripts/
│   ├── smoke.mjs                # checkPackage smoke (live registry)
│   └── smoke-facade.mjs         # watchlist / settings / ciScan smoke (live registry)
└── packages/
    ├── core/                    # @npm-safe/core engine
    │   ├── src/                 # index.ts facade + registry/scanner/store/scheduler/llm/translator
    │   ├── test/                # vitest suites (network-free)
    │   └── API.md / ARCHITECTURE.md / SCANNER_RULES.md
    └── tool-npm-safe/           # @npm-safe/dsh-tool-npm-safe plugin
        ├── src/index.ts         # apply / inject + 14 tool definitions
        ├── cordis.yml / cordis.patch.yml
        └── test/                # tool-level tests (engine-stubbed, network-free)
```

## Quick Start

**Requirements**: Node.js ≥ 22.19 (or 24+, verified on v24.18.0), Git ≥ 2.26,
pnpm 11.7.0 (via Corepack), and access to the npm registry.

```sh
# 1) Activate Corepack and lock the pnpm version
corepack enable
corepack prepare pnpm@11.7.0 --activate
pnpm --version            # should print 11.7.0

# 2) Install dependencies
pnpm install
```

> **better-sqlite3 build allowlist**: `better-sqlite3` is a native module and
> pnpm 11 blocks its build scripts by default. Allowlist is configured in
> `pnpm-workspace.yaml` (`pnpm.onlyBuiltDependencies` / `allowBuilds`) and
> `.npmrc` (`only-built-dependencies[]=better-sqlite3`). If still blocked, run
> `pnpm approve-builds` and select `better-sqlite3`.

**Static verification** (order matters: build first so `packages/core/dist`
exists for the plugin to resolve):

```sh
pnpm run build            # builds core → packages/core/dist
pnpm run typecheck
pnpm run test
```

**One-shot smoke tests** (network required — hits the live npm registry):

```sh
node scripts/smoke.mjs lodash                  # prints level / score / findings
node scripts/smoke.mjs definitely-not-real-xyz # missing package → exists:false
node scripts/smoke-facade.mjs                  # watchlist / settings / ciScan
```

## CI

`.github/workflows/ci.yml` runs on every push / PR: Node 22.19 and 24 matrix,
Corepack enabled, `pnpm install` → `pnpm --filter @npm-safe/core run build` →
`pnpm run typecheck` → `pnpm run test`.

## Manual dsh Verification

End-to-end verification in dsh (Web UI / headless) is a manual step. Install
the dsh CLI and configure an API key:

```sh
pnpm add -g @deepseek-ai/dsh@0.1.0-rc.6
# or run without a global install:
# npx @deepseek-ai/dsh@0.1.0-rc.6 web --patch ./packages/tool-npm-safe/cordis.patch.yml

# configure DEEPSEEK_API_KEY in a root .env file
```

Then verify the `check_package` tool:

```sh
# Web UI: open http://127.0.0.1:3080 and ask "Use the check_package tool to check lodash"
pnpm dsh web --patch ./packages/tool-npm-safe/cordis.patch.yml

# headless:
pnpm dsh --profile headless "check lodash"
```

> All dsh packages are pinned to the same RC family (`0.1.0-rc.6`, cordis
> `^4.0.1`). Upgrades must stay aligned across the whole repo.

## Documentation

- [HANDOVER.md](docs/HANDOVER.md) — status, task progress, key decisions, known caveats
- [npm-safe-dsh-plugin-migration.md](docs/npm-safe-dsh-plugin-migration.md) — migration spec (authoritative)
- `packages/core/API.md` · `ARCHITECTURE.md` · `SCANNER_RULES.md` — engine reference

## License

[Apache-2.0](LICENSE) — Copyright 2026 Nisconder, InfiniteScope, Escap1ng, StoryBegins.
