# Changelog

## 2.0.2 - 2026-11-14

- Align both adapter packages and the vendored scanner with `@npm-safe/core@2.0.2`.
- Inherit explicit OpenAI-compatible reasoning-effort configuration while preserving the model service's default when unset.
- Include the shared source-review fixes: one final-answer opportunity after a rejected supplementary request, and deterministic offset correction for a unique verbatim quote within the supplied evidence. Path and evidence boundaries, schema checks, and verdict constraints remain enforced.

## 2.0.1 - 2026-11-13

- Align both adapter packages with the shared `@npm-safe/core@2.0.1` release.
- Update the DSH SDK and supported host floor to `0.2.2-rc.3`; retain the shipped `dsh.bundle.patch` activation layer and declare manifest format 1.
- Declare the abstract `dsh-jobs` host peer and register the background job kind through its public type extension point.
