# Charkha

**Waste-to-Carbon-Value Chain Tracker** — HackOut'26, Circular Carbon Ecosystem.

Crop residue that would otherwise be burned is detected from satellite, routed to a
nearby conversion unit, verified in the field, and issued as a retirable carbon
credit. One task id threads the whole chain: **detection → match → evidence →
decision → credential → retirement**.

Detection is already a solved problem. This is what happens *after* detection.

---

## Quick start

```bash
pnpm install
pnpm setup:env                # writes .env with fresh random secrets
# then paste your free FIRMS_MAP_KEY into .env
docker compose up -d db
pnpm db:push && pnpm seed
pnpm dev
```

There are no default passwords in this repo on purpose - a default is a value
that quietly reaches the VPS. `pnpm setup:env` fills the blanks for you.

Whole stack in containers (what the demo runs on):

```bash
docker compose up -d          # db, migrate, four agents, gateway, caddy
```

`migrate` applies the schema and seeds conversion units, and the agents wait for
it to finish rather than racing an empty database.

Open <http://localhost:5173>. The API is on `:4000`, agents on `:4001–:4004`.

Free FIRMS key: <https://firms.modaps.eosdis.nasa.gov/api/map_key/>

---

## Layout

| Path | What | Owner |
|---|---|---|
| `packages/core` | Shared contracts, hash chain, geo, carbon math | core |
| `packages/a2a` | Agent server/client wrapper, Agent Cards, JWT, rate limit | core |
| `packages/db` | Drizzle schema + the append-only decision ledger | core |
| `apps/gateway` | Single-origin API, trace assembly, serves the SPA | core |
| `agents/producer` | Burn-detection ingest, residue lots | Harsh |
| `agents/matchmaker` | Lot → conversion unit assignment | Harsh |
| `agents/verifier` | ONNX evidence scoring, methodology checks | Hem |
| `agents/registry` | Carbon math, credential issuance and retirement | Ayush |
| `apps/web` | Three thin views on one backend | one view each |
| `ml/` | Training and ONNX export | Hem |

---

## Writing an agent skill

You never touch the A2A protocol. Write a plain async function and register it:

```ts
await startAgentServer({
  card,
  port: 4002,
  skills: {
    runMatching: { input: RunMatchingInput, run: runMatching },
  },
});
```

The wrapper handles task lifecycle, event ordering, part encoding, JWT auth
and rate limiting. Throw inside your handler and the task correctly ends
`failed`. Input is already parsed and validated against the zod schema.

Calling another agent is one function:

```ts
const { taskId, output } = await callAgent(AGENTS.verifier(), "verifyEvidence", evidence);
```

---

## Rules that keep us unblocked

1. **`packages/core/src/contracts.ts` is the only place a boundary type is
   defined.** Need a field? Add it there, in its own small PR, and say so in
   the channel. Never widen a type inside your own agent.
2. **Everything goes through a PR.** No direct pushes to `main`.
   Branch naming: `harsh/producer-firms-ingest`, `hem/verifier-onnx`, etc.
3. **One decision per meaningful action**, via `appendDecision()`. Never write
   to `decision_log` any other way, and never UPDATE or DELETE a row in it.
4. **Don't restyle another owner's view** without asking them.
5. **Every number in carbon math carries a `source`.** "We guessed" loses.

## Data rules — non-negotiable

- The field photo **never leaves the device**. Inference runs in the browser;
  we submit a hash and scores. No base64 images in any request body.
- **No third-party AI APIs.** All inference is local — `onnxruntime-node` on
  the server, `onnxruntime-web` in the browser.
- **One outbound call**, a read-only `GET` to the fire-detection feed. We pull
  public data in; nothing of ours goes out. No analytics, no telemetry.
- The registry signing key is **server-side only** and never enters a client
  bundle or a commit.
- Map tiles from OpenStreetMap — no vendor account, no per-request identity.

## Verify before you open a PR

```bash
pnpm verify
```

Typecheck, tests, web build. CI runs the same three. A red PR does not get
reviewed.
