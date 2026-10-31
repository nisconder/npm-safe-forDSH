# DSH compatibility API

`@npm-safe/core-dsh` re-exports the shared engine's public API. The authoritative
scanner API is documented in the
[`npm-safe` core package](https://github.com/nisconder/npm-safe/tree/main/packages/core).

The facade extends `NpmSafeEngine` with two compatibility operations:

```ts
engine.searchPackages(query, { size?: number, signal?: AbortSignal })
engine.ciScan({
  dir?: string,
  failLevel?: SecurityLevel,
  lockfile?: boolean,
  prod?: boolean,
  deep?: boolean,
  signal?: AbortSignal,
})
```

The positional shared-core search API remains accepted. `ciScan()` returns
`{ dir, scannedAt, dependencyCount, failLevel, failed, summary, packages }`.
Each package entry includes the checked version, level, score, finding count,
a `failed` flag, the findings behind that result, and any error. Lockfile scans retain each distinct name/version pair and
production scans retain its transitive dependency graph. Critical findings,
unknown assessments, missing packages, and scan errors fail the default gate.

Single checks support shared `version`, `forceRefresh`, `deep`, and `signal`
options. Foreground operations and background refresh use the shared engine's
cooperative cancellation. A caller must act on `failed`; this facade does not
intercept or block an installation command.
