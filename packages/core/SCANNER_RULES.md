# Shared scanner rules

Rule implementations and their documentation are maintained in the
[`npm-safe` core scanner](https://github.com/nisconder/npm-safe/tree/main/packages/core/src/scanner).
This repository contains no separate rule implementation.

Use `rules_list` in DSH, or `engine.listRules()` programmatically, to inspect
the exact effective rules, enable flags, and severity overrides in the pinned
core release. Rule configuration changes invalidate cached assessments under
the shared scanner fingerprint.

Metadata and deep content checks provide evidence about a selected package
version. They cannot guarantee that a package is safe. The DSH plugin exposes
these checks as tools; enforcing an install policy is the caller's job.
