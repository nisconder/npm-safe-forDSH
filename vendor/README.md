# Shared scanner release

The only scanner source is maintained in
[`nisconder/npm-safe`](https://github.com/nisconder/npm-safe). This directory
contains its built release package, not another editable scanner source tree.
The workspace override pins the exact bytes recorded in `core-release.json`
and `pnpm-lock.yaml`, so the checked-out adapter can be tested before that
core release is published. The wrapper's published manifest depends on the
same exact registry version.

To update from a locally built core:

1. In the main `npm-safe` repository, run the core build and regression tests,
   then pack `packages/core` with `npm pack` or `pnpm pack`.
2. In this repository, run
   `node scripts/use-core-tarball.mjs --core-tarball <path-to-built-core.tgz>`.
   This checks the package name, exact version, and built entrypoints, copies
   the release, and records its SHA-512 checksum. No install scripts run.
3. Regenerate the lockfile with `pnpm install --lockfile-only --ignore-scripts`
   and install the already reviewed development dependencies. Use `--offline`
   when they are cached.
4. Run the same script with `--verify` to build, typecheck, and test both
   adapter packages against that tarball using the existing dependencies.

For an official release, obtain the corresponding `@npm-safe/core` tarball
from the registry and follow steps 2–4. Publish the shared core version first,
then `@npm-safe/core-dsh`, then the DSH plugin. Do not publish a wrapper whose
exact core dependency is still unavailable. Remove old tarballs once no
workspace override references them; keep the lockfile and checksum together.

The DSH facade owns only its legacy search option shape and CI report format.
Version resolution, lockfile traversal, risk policy, scanning, cache validity,
and cooperative cancellation are all imported from the shared core.
