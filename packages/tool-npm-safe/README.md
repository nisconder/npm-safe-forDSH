# @npm-safe/dsh-tool-npm-safe

[![Version](https://img.shields.io/npm/v/@npm-safe/dsh-tool-npm-safe?color=2196F3)](https://www.npmjs.com/package/@npm-safe/dsh-tool-npm-safe)
[![License](https://img.shields.io/badge/license-Apache--2.0-4CAF50)](https://github.com/nisconder/npm-safe-forDSH/blob/main/LICENSE)
![Language](https://img.shields.io/badge/Language-TypeScript-3178C6?logo=typescript&logoColor=white)
[![Node](https://img.shields.io/badge/Node.js-22.19%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org)

A [DeepSeek Harness (dsh)](https://github.com/deepseek-ai/deepseek-harness) tool plugin that exposes the [`@npm-safe/core-dsh`](https://www.npmjs.com/package/@npm-safe/core-dsh) supply-chain security engine as 14 dsh tools. AI agents can call package security scans directly inside a conversation, acting as a "check before you install" gate.

## Installation

```bash
pnpm add @npm-safe/dsh-tool-npm-safe
```

### Peer Dependencies

This plugin requires the following peer packages (all from the same RC family):

| Package | Version |
|---|---|
| `@deepseek-ai/cordis` | `^4.0.1` |
| `@deepseek-ai/dsh-tools` | `0.1.0-rc.6` |
| `@deepseek-ai/dsh-jobs-local` | `0.1.0-rc.6` |

## Quick Start

> **`DEEPSEEK_API_KEY` is required.** Export it in your environment or place it in a `.env` file at the project root before launching dsh.

```bash
# Web UI
pnpm dsh web --patch ./node_modules/@npm-safe/dsh-tool-npm-safe/cordis.patch.yml

# Headless
pnpm dsh --profile headless "check lodash"
```

## Tools

The plugin registers the following 14 tools in a dsh session:

| Tool | Purpose | Execution |
|---|---|---|
| `check_package` | Check one package; optional `deep` tarball inspection | Foreground (signal-forwarded) |
| `check_packages` | Check multiple packages; optional `deep` inspection | Foreground (rate-limited) |
| `search_packages` | Keyword search of the npm registry | Foreground |
| `watch_add` | Add a package to the watchlist | Foreground |
| `watch_remove` | Remove a package from the watchlist | Foreground |
| `watch_list` | List all watched packages | Foreground |
| `rules_list` | List all scan rules with status | Foreground |
| `rule_enable` | Enable a scan rule (persisted) | Foreground |
| `rule_disable` | Disable a scan rule (persisted) | Foreground |
| `rule_set_severity` | Override a rule's severity (persisted) | Foreground |
| `settings_get` | Read an engine setting | Foreground |
| `settings_set` | Write an engine setting (persisted) | Foreground |
| `ci_scan` | Dependency gate scan; optional `deep` inspection | Foreground |
| `refresh_all` | Refresh all watched packages | Background (`ctx.jobs.start`) |

## Usage Examples

### Check a single package

```
> Use check_package to check lodash

lodash@4.18.1: safe (85/100, 2 findings)
```

For higher assurance before installation, ask the agent to set `deep: true`:

```
> Deep-scan lodash with check_package before installing it

lodash@4.17.21: safe (82/100, 2 findings); deep scan complete, 154 files, integrity verified
```

Deep mode downloads the published tarball, rejects cross-origin downloads,
verifies npm integrity metadata, and inspects bounded source content entirely
in memory. It is optional because archive downloads add latency and bandwidth.

### Batch check

```
> Use check_packages to check lodash, express, and axios

lodash: safe (85/100, 2 findings)
express: suspicious (62/100, 5 findings)
axios: safe (90/100, 1 findings)
```

### CI gate scan

```
> Use ci_scan to scan dependencies

dir: /project
dependencies: 142
fail level: dangerous
failed: false
safe: 130
suspicious: 10
dangerous: 2
```

### Background refresh

```
> Use refresh_all to refresh all watched packages

Background refresh job started: job-abc123
```

## Engine

This plugin is powered by [`@npm-safe/core-dsh`](https://www.npmjs.com/package/@npm-safe/core-dsh), a fork of [`@npm-safe/core`](https://www.npmjs.com/package/@npm-safe/core) re-architected for dsh integration. The engine provides:

- **10 metadata rules plus 12 deep-content rules** for archive integrity, unsafe paths, remote shell execution, obfuscation, process execution, secrets, and binaries
- **SQLite-backed caching** with TTL-based staleness (default 1 hour)
- **TokenBucket rate limiter** (5 tokens/s, 10 burst) to prevent registry throttling
- **Typed API** for programmatic use

## Original Repository

- **This plugin**: https://github.com/nisconder/npm-safe-forDSH
- **Engine original repository**: https://github.com/nisconder/npm-safe
- **dsh platform**: https://github.com/deepseek-ai/deepseek-harness

## License

[Apache-2.0](https://github.com/nisconder/npm-safe-forDSH/blob/main/LICENSE) — Copyright 2026 Nisconder, InfiniteScope, Escap1ng, StoryBegins.
