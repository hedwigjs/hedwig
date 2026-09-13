# Security Policy

## Supported versions

Hedwig is pre-release. Only the latest published version of each package
receives fixes.

| Package | Status |
| --- | --- |
| `@hedwigjs/broker` | Published (0.1.1) |
| `@hedwigjs/devtools` | Published (0.1.1) |
| `@hedwigjs/create-registry` | Published (0.1.1) |
| `@hedwigjs/client`, `@hedwigjs/react`, `@hedwigjs/vue` | Not yet published |

What the runtime enforces at each trust boundary — and what stays the
application's job — is written down in
[`docs/content/spec/threat-model.md`](./docs/content/spec/threat-model.md).
Please read it before reporting: behaviour listed there as the
application's responsibility is not a vulnerability in Hedwig.

## Reporting a Vulnerability

If you find a security issue, please report it privately by opening a
GitHub Security Advisory rather than a public issue, or email the
maintainer directly.

Please include:
- affected package and version
- reproduction steps
- suggested severity (advisory, important, critical)

We'll acknowledge within 72 hours and coordinate disclosure.
