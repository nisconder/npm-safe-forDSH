# Security Policy

## Supported versions

Security fixes are applied to the latest release. DeepSeek Harness is still in
developer preview, so pin the plugin and its DSH peer dependencies to versions
you have tested.

## Report a vulnerability

Please use GitHub's private vulnerability reporting for this repository:

<https://github.com/nisconder/npm-safe-forDSH/security/advisories/new>

Do not open a public issue for an unpatched vulnerability. Include the affected
version, impact, reproduction steps, and any suggested mitigation. You should
receive an acknowledgement within 72 hours.

## Scope and guarantees

`npm-safe-forDSH` provides evidence-based risk signals; a `safe` result is not a
guarantee that a package is harmless. Deep scans are bounded by design and may
truncate oversized archives or files. Review the report, pin dependencies, and
apply normal sandboxing and least-privilege controls to production agents.
