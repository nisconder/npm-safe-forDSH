<div align="center">

# npm-safe-forDSH
**npm Supply-Chain Security for DeepSeek Harness**

[![Version](https://img.shields.io/github/v/release/nisconder/npm-safe-forDSH)](https://github.com/nisconder/npm-safe-forDSH/releases/latest)
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

## Installation

These packages are **not published to the npm registry**. Build and consume
them from source.

- **Source & releases**: https://github.com/nisconder/npm-safe-forDSH
  ([latest release](https://github.com/nisconder/npm-safe-forDSH/releases/latest))
- **Engine original repository** (read-only reference):
  https://github.com/nisconder/npm-safe

### Build from source

Follow the [Quick Start](#quick-start) steps above to install dependencies and
build the workspace:

```bash
corepack enable
corepack prepare pnpm@11.7.0 --activate
pnpm install
pnpm run build
```

After building, the engine output lives in `packages/core/dist` and the dsh
plugin output in `packages/tool-npm-safe/lib`. Reference them via pnpm
workspace links or point your tooling at the built paths directly.

### Using the plugin in a dsh runtime

> **`DEEPSEEK_API_KEY` is required.** Export it in your environment or place it
> in a `.env` file at the project root before launching dsh.

```bash
pnpm dsh web --patch ./packages/tool-npm-safe/cordis.patch.yml
# Web UI: http://127.0.0.1:3080 — ask "check lodash"

# Or run headless:
pnpm dsh --profile headless "check lodash"
```

All dsh peer packages must belong to the same RC family (`@deepseek-ai/dsh-tools`
/ `dsh-jobs-local` 0.1.0-rc.x, `@deepseek-ai/cordis` ^4.0.1). Upgrades must
stay aligned across the whole repo.

### Using the engine as a library

```ts
import { NpmSafeEngine } from "@npm-safe/core";

const engine = new NpmSafeEngine();
const result = await engine.checkPackage("lodash");
console.log(result);
await engine.close();
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
Corepack enabled, `pnpm install` → `pnpm --filter @npm-safe/core run build` →
`pnpm run typecheck` → `pnpm run test`.

## Manual dsh Verification

End-to-end verification in dsh (Web UI / headless) is a manual step. Install
the dsh CLI and configure an API key:

```bash
pnpm add -g @deepseek-ai/dsh@0.1.0-rc.6
# configure DEEPSEEK_API_KEY in a root .env file
```

Then verify the `check_package` tool:

```bash
pnpm dsh web --patch ./packages/tool-npm-safe/cordis.patch.yml
# Web UI: open http://127.0.0.1:3080 and ask "check lodash"

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
