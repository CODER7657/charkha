# Charkha — working context

Hackathon build, 36–40 hours, four people. **Waste-to-Carbon-Value Chain Tracker.**
Crop residue detected from satellite → routed to a conversion unit → verified in
the field → issued as a retirable carbon credit. One task id threads the whole
chain.

## Architecture in one line

Four A2A agents (producer, matchmaker, verifier, registry) behind one gateway,
three thin views on one origin, every decision written to a hash-chained
append-only ledger, the final credit issued as a W3C Verifiable Credential.

## Rules that are not negotiable

1. **`packages/core/src/contracts.ts` is the only place a boundary type lives.**
   Need a field? Separate one-file PR, and say so in the channel. Never widen a
   type inside an agent.
2. **The field photo never leaves the device.** Inference runs in the browser via
   `onnxruntime-web`; we submit `{ imageHash, modelHash, modelVersion,
   clientScores, gps, batch }`. No base64 image in any request body, ever.
3. **No hosted AI APIs.** All inference is local — `onnxruntime-node` on the
   server, `onnxruntime-web` in the browser. CI fails the build if an
   `api.openai.com`-shaped endpoint appears.
4. **One outbound call**, a read-only `GET` to the NASA FIRMS fire feed. We pull
   public data in; nothing of ours goes out. No analytics, no telemetry, no CDN.
5. **`appendDecision()` is the only way to write to `decision_log`.** Exactly once
   per meaningful decision. Never UPDATE or DELETE a row there.
6. **Secrets live in `.env`, server side only.** `REGISTRY_DID_SEED` must never
   reach a client bundle, a log line, or a commit.
7. **Every number in carbon math carries a `source` string.** "We guessed" is a
   losing answer to "where did 2.4 come from".

## Ownership — do not edit another owner's files without asking

| Path | Owner |
|---|---|
| `packages/*`, `apps/gateway`, `apps/web/src/{App,api,ui.css}` | core (@CODER7657) |
| `agents/producer`, `agents/matchmaker`, `apps/web/src/views/OperatorMap.tsx` | @harshpansuriya71-sudo |
| `agents/verifier`, `ml/`, `apps/web/src/views/FieldCapture.tsx` | @Hem60 |
| `agents/registry`, `packages/core/src/carbon.ts`, `apps/web/src/views/AuditConsole.tsx` | @Ayush3422 |

## Writing an agent skill

You never touch the A2A protocol. Write a plain async function:

```ts
export const runMatching = async (input, ctx) => { ... };
```

and register it in the agent's `index.ts`:

```ts
skills: { runMatching: { input: RunMatchingInput, run: runMatching } }
```

The wrapper in `packages/a2a` handles the task lifecycle, event ordering, part
encoding, JWT auth and rate limiting. Input arrives already parsed against the
zod schema. Throw and the task correctly ends `failed`.

Calling another agent:

```ts
const { taskId, output } = await callAgent(AGENTS.verifier(), "verifyEvidence", evidence);
```

## Commands

```bash
pnpm install
docker compose up -d db
pnpm db:push && pnpm seed
pnpm dev            # all agents + gateway + web
pnpm verify         # lint + typecheck + test + web build — run before every PR
```

## Conventions

- TypeScript, ESM, `.ts` extensions on relative imports (the tsconfig allows it).
- `type` imports use `import type` — `verbatimModuleSyntax` is on.
- Tests are `vitest`, colocated as `*.test.ts` next to the file they cover.
- No new dependency without saying so in the channel. We have what we need.
- Prefer a boring, readable implementation over a clever one. This is a 40-hour
  build and someone else has to debug it at 3am.

## What we deliberately do not build

No blockchain, no token, no detection model of our own (that problem is solved
elsewhere — we start after detection), no real Kafka/NATS (in-memory queue behind
a broker-shaped interface, disclosed honestly), no native mobile app, no MILP
solver, no RL.

## Testing bar

A PR merges when it is green and the behaviour is actually covered:

- the happy path
- **at least one failure case** — the thing that must be refused
- for anything touching the ledger or credentials, a test that proves the
  guarantee (chain detects tampering, a batch cannot be credited twice,
  retirement is idempotent)

CI runs lint, typecheck, tests, web build, boots all four agents and checks each
serves a valid Agent Card, and builds the Docker image. If it is red it does not
get reviewed.
