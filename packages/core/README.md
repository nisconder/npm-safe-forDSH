# @npm-safe/core-dsh

A thin compatibility facade over the shared `@npm-safe/core` scanner. This
package contains no scanner, registry, scheduler, database, or cache copy.
See [the shared-core release workflow](../../vendor/README.md).

```ts
import { NpmSafeEngine } from '@npm-safe/core-dsh'

const engine = new NpmSafeEngine()
try {
  const report = await engine.checkPackage('lodash', {
    version: '4.17.21', forceRefresh: true, deep: true,
  })
  console.log(report.latestVersion, report.security.overallLevel)
} finally {
  engine.close()
}
```

All shared engine exports are re-exported. The facade preserves
`searchPackages(query, { size, signal })` and adds `ciScan(options)` to format
shared lockfile parsing, exact-version checks, and failure policy for DSH.
Cancellation rejects the operation, including cancellation of the final
dependency; it is never returned as a successful partial CI scan.

- [API](API.md)
- [Architecture](ARCHITECTURE.md)
- [Scanner rules](SCANNER_RULES.md)
