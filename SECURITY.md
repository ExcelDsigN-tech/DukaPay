# Security Policy

For the authentication and authorization model (roles, scopes, JWT flow,
API-key namespaces, cookie attributes, and route guards) see
[docs/SECURITY-MODEL.md](docs/SECURITY-MODEL.md).

## Supported Versions

Only the current `main` branch and the last tagged release receive security fixes.

| Version  | Supported          |
| -------- | ------------------ |
| Main     | :white_check_mark: |
| Last Tag | :white_check_mark: |
| Older    | :x:                |

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub issues,
pull requests, or discussions.**

Report privately through GitHub: open the repository's **Security** tab and
click **Report a vulnerability**. Only the maintainers can see the report.

### What to include

- A description of the vulnerability and its impact.
- Steps to reproduce it.
- The affected file, endpoint, or contract, and the commit you tested.
- Any relevant logs or output.

### Scope

- **In scope:** smart contracts, backend, and frontend code in this repository.
- **Out of scope:** third-party services, dependencies, and infrastructure not
  managed in this repository.

## Response and Disclosure

- We aim to acknowledge reports within **5 business days**.
- We ask for a **90-day disclosure window** so we can investigate and ship a
  fix before details are made public.

## No Bug Bounty

DukaPay is an open-source project and **does not run a bug bounty program**.
We do not offer cash, token, or any other rewards for vulnerability reports.

## Safe Harbor

We will not pursue legal action against researchers who:

1. Make a good faith effort to avoid privacy violations, data destruction, or
   disruption to our services.
2. Only interact with accounts they own or have explicit permission to use.
3. Do not exploit a vulnerability beyond what is needed to confirm it exists.
4. Report promptly and do not disclose publicly before a fix is released.
