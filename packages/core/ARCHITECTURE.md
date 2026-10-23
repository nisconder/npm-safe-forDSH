# Shared scanner architecture

The plugin imports `@npm-safe/core-dsh`, a small subclass of `@npm-safe/core`.
All registry requests, scans, cache reads, rule configuration, rate limiting,
and refresh work execute in the shared package. The facade only preserves the
legacy DSH search options and CI result format. It imports shared dependency
parsing and failure policy rather than implementing separate copies.

`packages/core/test/shared-core.test.ts` runs this facade against the actual
shared release package. It covers version selection, cache bypass, locked
production transitives, failure policy, search cancellation, and cancellation
of the final CI dependency. Plugin tests separately verify DSH schemas and
argument forwarding.

The workspace pins a built release under `vendor/`, with a real checksum and
lockfile entry. See [updating that release](../../vendor/README.md). Published
packages depend on its exact registry version. Scanner fixes and detection
tests belong in [`nisconder/npm-safe`](https://github.com/nisconder/npm-safe).
