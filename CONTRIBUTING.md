# Contributing

Thanks for helping make npm installs safer for DeepSeek Harness users.

## Good first contributions

- Add a focused detection rule with fixtures and tests.
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
keys, npm tokens, registry credentials, or package tarballs.

For vulnerabilities, follow [SECURITY.md](SECURITY.md) instead of opening a
public issue.
