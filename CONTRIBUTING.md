# Contributing

## Ground rules

- **Every decision is one append-only ledger row.** Never edit or delete a row; a change
  that breaks the hash chain breaks the system's main claim.
- **Agents own their domains.** Business logic lives in the agent that owns it; Saathi and
  the gateway only call skills.
- **Refusals are features.** The Break It attacks must keep failing for the reason their
  screen states; add a test when you add a guard.
- One issue, one branch, one pull request, with tests including at least one failure case.
- No secrets, real farmer data or field photos in the repository.

## Set up and test

```bash
pnpm install --frozen-lockfile
pnpm verify          # lint (zero warnings), typecheck, tests, web build
docker compose up -d # the full stack, for end-to-end work
```

Tests that need Postgres skip without one; CI runs them.

## Pull requests

Use the template: what it does, what it closes, and the verification checklist with real
output. Security issues: see [SECURITY.md](SECURITY.md).
