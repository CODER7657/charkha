# Security policy

Charkha moves carbon credits between agents and issues verifiable credentials, so a way
to credit something twice, forge a verdict or read another party's data is a serious bug.

## Reporting a vulnerability

Report privately through GitHub:
[Security → Report a vulnerability](https://github.com/CODER7657/charkha/security/advisories/new).
Do not open a public issue. You should get a reply within 7 days.

In scope: the four agents and Saathi (`agents/`), the gateway (`apps/gateway`), the shared
A2A and credential code (`packages/`), and the web app. The Break It screen lists the
attacks the system is already expected to refuse; a way past any of them is in scope.

## How the project handles secrets and data

- Agent-to-agent calls carry signed bearer tokens; an unauthenticated `/a2a` call is
  refused before the protocol handler runs (`packages/a2a/src/server.auth.test.ts`).
- Keys live in a git-ignored `.env`; CI fails on a committed `.env` or private key.
- Field photos never leave the device; CI checks there are no third-party inference endpoints.
