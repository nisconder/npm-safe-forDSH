# @npm-safe/core-dsh

Local-first npm supply-chain security engine used by
[`npm-safe-forDSH`](https://github.com/nisconder/npm-safe-forDSH), the DeepSeek
Harness plugin that checks packages before an agent installs them.

[![npm](https://img.shields.io/npm/v/@npm-safe/core-dsh?logo=npm&color=CB3837)](https://www.npmjs.com/package/@npm-safe/core-dsh)
[![CI](https://img.shields.io/github/actions/workflow/status/nisconder/npm-safe-forDSH/ci.yml?branch=main&label=CI)](https://github.com/nisconder/npm-safe-forDSH/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-Apache--2.0-4CAF50)](https://github.com/nisconder/npm-safe-forDSH/blob/main/LICENSE)

## Install

```bash
pnpm add @npm-safe/core-dsh
```

## Example

```ts
import { NpmSafeEngine } from "@npm-safe/core-dsh";

const engine = new NpmSafeEngine();
const report = await engine.checkPackage("lodash", { deep: true });

console.log(report.level, report.score, report.findings);
await engine.close();
```

Metadata mode checks package history, maintainers, lifecycle scripts, registry
settings, and other supply-chain signals. Deep mode additionally downloads the
same-origin published tarball, verifies npm integrity metadata, and performs a
bounded in-memory content scan.

- [API reference](https://github.com/nisconder/npm-safe-forDSH/blob/main/packages/core/API.md)
- [Scanner rules](https://github.com/nisconder/npm-safe-forDSH/blob/main/packages/core/SCANNER_RULES.md)
- [Architecture](https://github.com/nisconder/npm-safe-forDSH/blob/main/packages/core/ARCHITECTURE.md)
- [DeepSeek Harness plugin](https://www.npmjs.com/package/@npm-safe/dsh-tool-npm-safe)

Apache-2.0. This is an independent community project and is not affiliated with
or endorsed by DeepSeek.
