# Security Policy

## Supported version

Security fixes are applied to the current `main` branch.

## Reporting a vulnerability

Do not open a public issue containing credentials, customer data, payment data or a working exploit. Contact the repository owner privately and include:

- the affected route or component
- steps to reproduce
- expected and actual behavior
- the potential impact
- a proposed fix, when available

## Credential handling

- Secrets must only be supplied through environment variables or the deployment platform's secret store.
- Never commit `.env` files, passwords, API keys, SMTP credentials or database dumps.
- Any credential that has appeared in Git history must be treated as compromised and rotated immediately.
- After rotation, remove the secret from Git history with an approved history-rewrite procedure and invalidate old deployments or caches.

## Minimum release checks

A production release requires successful CI tests, Docker build, dependency audit and CodeQL analysis. High-risk changes to authentication, payments, uploads or order status transitions require an additional review.
