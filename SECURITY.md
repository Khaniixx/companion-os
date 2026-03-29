# Security Policy

## Supported Versions

Companion OS is still pre-1.0. Security fixes are only guaranteed on the latest
state of the default branch.

| Version | Supported |
| ------- | --------- |
| `main`  | Yes       |
| older commits and forks | No |

## Reporting A Vulnerability

Do not report vulnerabilities in a public issue, discussion, or pull request.

Use one of these private paths instead:

1. Open a private GitHub security advisory draft for the repository.
2. Contact the repository owner through a private maintainer-controlled GitHub
   channel if that advisory flow is not available.

Include as much detail as possible:

- Affected component or path
- Impact and severity estimate
- Reproduction steps or proof of concept
- Whether the issue requires local access, network access, or user interaction
- Any suggested mitigation

## Response Expectations

Maintainers will aim to:

- Acknowledge the report within 5 business days
- Confirm whether the report is in scope
- Share remediation status when a fix is planned
- Credit the reporter after release when disclosure is appropriate

## In Scope

Examples of in-scope reports include:

- Remote code execution or local privilege escalation paths
- Permission boundary bypasses
- Secrets exposure
- Unsafe skill execution paths
- Broken trust boundaries between the desktop shell, runtime, shared packages,
  and skills
- Vulnerabilities in installation, update, or onboarding flows

## Out Of Scope

The following are usually out of scope unless they create a concrete security
impact:

- Missing best-practice headers without exploitation
- Version-only reports without a demonstrable impact path in this repository
- UI bugs that do not affect permissions, privacy, or trust boundaries
