# Contributing

Thanks for helping make npm installs safer for DeepSeek Harness users.

## Good first contributions

- Add detection rules and scanner fixtures in the shared [npm-safe repository](https://github.com/nisconder/npm-safe).
- Improve a finding's evidence or recommendation.
- Reproduce the plugin on another supported operating system.
- Improve DSH compatibility documentation.
- Report a false positive with the exact package and version.

## Development

```bash
corepack enable
corepack prepare pnpm@11.7.0 --activate
pnpm install
pnpm run build
pnpm run typecheck
pnpm run test
```

Keep changes focused and include tests for behavior changes. Before opening a
pull request, run the full build, typecheck, and test suite. Never commit API
keys, npm tokens, registry credentials, or unrelated package tarballs. The
reviewed shared-core release in `vendor/` is managed only through
`scripts/use-core-tarball.mjs`; see [the release workflow](vendor/README.md).

For vulnerabilities, follow [SECURITY.md](SECURITY.md) instead of opening a
public issue.
