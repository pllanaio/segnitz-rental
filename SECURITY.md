# Security Policy

Security fixes target current `main`. Report vulnerabilities privately to the
repository owner; include affected behavior, reproduction and impact without
customer data, credentials or a public working exploit.

## Secrets and runtime

Provide secrets through the deployment secret store or private environment files.
Never commit credentials, `.env`, auth links, database dumps or private image data.
Use the shared redaction boundary for logs; financial idempotency keys must remain
stable even when sensitive authentication metadata is redacted.

A previously exposed credential requires a separately authorized operator rotation
and incident assessment. History rewriting, token rotation or destructive cleanup
are not automatic development actions. Existing customer/business data must be
preserved.

Production requires validated HTTPS `BASE_URL`, a strong `SESSION_SECRET`,
verified `TRUST_PROXY` topology, secure cookies and real enabled integrations.
Simulator combinations are rejected before migrations/HTTP start. Mail maintenance
pauses jobs; it must not mark unsent mail as sent. Keep CSRF, session regeneration,
`auth_version`, ownership checks and private return images enabled.

The CSP forbids inline scripts and event handlers. Versioned browser libraries and
license notices are maintained with the application; npm audit alone does not
cover browser assets. Do not weaken CSP to accommodate unused code.

## Required release checks

All checks run on the final release commit: syntax/unit on supported Node 22/24,
MySQL integration, real application Playwright, production dependency audit,
container vulnerability scan, CodeQL and final `Release gate`. Authentication,
payments, upload and availability changes need additional human review.

CI builds a single OCI artifact with SBOM/provenance. The manually triggered
publication workflow validates every exact-commit check and artifact digest,
copies the same OCI bytes with `--all --preserve-digests`, checks the registry
digest, then signs/attests that digest. It never rebuilds or updates `latest`.
Compose requires an explicitly reviewed `repository@sha256` image reference.
Publication and production deployment remain separately authorized actions.

## Required GitHub settings: not activated by this file

Observed 2026-09-13: `main` was unprotected with no required checks; repository
rulesets were empty. No settings were changed during implementation. Secret-
scanning settings and protected environments could not be verified through the
available read-only endpoint. Absence from repository metadata is not evidence
that a security feature is disabled.

Configure and independently verify:

- An active `main` ruleset blocking deletion and force pushes, requiring PRs,
  at least one independent review, dismissal of stale approvals, approval of the
  latest push, resolved conversations, strict up-to-date checks and no routine
  administrator bypass.
- Required checks exactly matching `Unit tests (Node 22)`, `Unit tests (Node 24)`,
  `MySQL integration tests`, `Playwright end-to-end tests`,
  `Production dependency audit`, `Build and scan release image`,
  `CodeQL security gate` and `Release gate` from this repository's Actions app.
- The `production-release` environment restricted to `main`, required independent
  reviewers, prevention of self-review and scoped registry credentials. Its name
  in a workflow does not create an approval policy.
- Dependabot alerts/security updates, secret scanning, supported non-provider
  patterns and push protection; assess feature availability and organization rules.
- The minimum workflow permissions and protected changes to workflows/release
  scripts, with ownership/review assignments approved by the operator.

The proposed values, exact observed evidence, failure tests and remaining checks
are in [docs/evidence-operations.md](docs/evidence-operations.md). Deployment,
monitoring, backup, restore, provider reconciliation and retention procedures are
in [docs/operations.md](docs/operations.md). A green CI result alone is not a
production approval or evidence of a successful restore.
