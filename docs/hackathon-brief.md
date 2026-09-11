# Hackathon Build Brief — Agent Mesh for Renewable Energy Intelligence / Circular Carbon Ecosystem

**Purpose of this doc:** We don't know which of two themes will be announced (1-2 hrs before build starts). This brief is pre-work so that once the real problem statement drops, you (coding agent) only need to: read the statement → pick the matching section below → start executing. Don't re-derive architecture from scratch; it's already decided.

**Hard constraint to respect throughout:** 36-hour hackathon. "Full production deployment" is not the goal. A coherent, honestly-scoped, technically real demo that a judge can poke at beats a wider but hollow build. Every section below flags what must be REAL vs what should be SIMULATED-BUT-DISCLOSED.

---

## 0. The two possible themes

| Theme | What it's actually asking for |
|---|---|
| **Renewable Energy Intelligence** | Forecasting, dispatch, and optimization of clean electricity — grid-edge decisions, demand/supply matching, storage/export timing |
| **Circular Carbon Ecosystem** | Closing a loop: capture, reuse, sequestration, waste-to-value. NOT the same as carbon *accounting* — accounting is adjacent, not sufficient on its own |

Do not force one theme's idea onto the other's statement. If the actual statement doesn't match either idea below cleanly, adapt the closest one rather than starting over — the chassis (Section 1) works for both.

---

## 1. Shared architecture chassis (build this FIRST, works for both themes)

### 1.1 Agent roles (domain-agnostic pattern)
- **Producer Agent** — represents a source of the resource/data being managed (a solar array, a farm plot, a factory byproduct stream)
- **Verifier Agent** — runs the ML model that validates/scores/audits an input (photo, sensor reading, forecast)
- **Registry Agent** — issues the final credential/decision and makes it queryable
- **Matchmaker Agent** (optional, use if circularity/trading is core to the idea) — pairs supply with demand

What changes between themes is only: (a) what the Producer produces, (b) what the Verifier's model classifies, (c) what the Registry certifies. The agent classes and message contracts stay identical. Do not build a generic "plugin" abstraction for this — just swap a config object (model path + schema) per theme. A real plugin system costs hours you don't have and buys nothing visible.

### 1.2 Protocol: A2A (Agent2Agent)
Use the official Agent2Agent protocol, not a custom REST scheme — it's an open, Linux Foundation-governed standard, and using it correctly is itself a credibility signal.
- **Task lifecycle**: submitted → working → input-required → completed. This is literally what the protocol is designed for, not a hack — use it for anything that takes noticeable time (verification jobs, batch scoring), so nothing blocks the UI while waiting.
- **Agent Cards**: static JSON documents describing what each agent can do and how to reach it. New producer onboarding = register a new Agent Card, not new code. This is your multi-tenancy story for the demo — show it live if possible.
- **Repos to pull from directly**:
  - `a2aproject/a2a-samples` → start from `samples/*/agents/helloworld` to get a working agent talking in <1 hr
  - `a2aproject/a2a-js` → sample list includes a minimal streaming agent showing the full task lifecycle over JSON-RPC, a push-notification agent (POSTs task updates to a webhook), and a cancellable-task agent — copy these patterns, don't write lifecycle logic from scratch
  - `a2aproject/a2a-inspector` → UI tool for inspecting live A2A traffic; useful to show judges during Q&A

### 1.3 Queue / orchestration — SIMULATE THIS
Do **not** stand up real Kafka/NATS in-hackathon. Use an in-memory queue or a Redis list with an interface shaped the same way. State clearly in the pitch: "designed to sit behind NATS/Kafka in production, in-memory here for the demo." Judges care about the architecture being *correct*, not about you having actually operated a message broker for 36 hours.

### 1.4 Verification / traceability layer
- **Hash-chained decision log** — every agent decision logs: input hash, model version, confidence score, Agent Card identity, timestamp, chained to the previous record's hash (`SHA256(prev_hash + record)`). ~1 hour of real work, high demo value — this is a good "look, tampering is detectable" moment.
- **W3C Verifiable Credential** as the final certificate — a real, adopted open standard for signed, checkable credentials, not a bespoke blockchain.
  - `decentralized-identity/did-jwt-vc` — lightweight, does exactly one job: create and verify W3C Verifiable Credentials/Presentations in JWT format. Fastest real path.
  - `decentralized-identity/veramo` — heavier framework with DID management, only reach for this if there's spare time.
  - `digitalbazaar/vc` — alternative if you want JSON-LD proofs instead of JWT.
  - Use a locally-generated `did:key` — skip standing up a real DID registry.
- Every record should be queryable end-to-end by A2A task ID: evidence → decision → credential, one thread a judge can follow live.

### 1.5 ONNX as the shared model format
Export every trained model (classifier, forecaster, whatever the domain needs) to ONNX once, then run it in two places from the same file:
- **Server-side**: `onnxruntime-node` / `onnxruntime` (Python) for the verifier agent
- **Client-side (the "offline/edge" interface)**: `onnxruntime-web` in the browser — do **not** attempt real ONNX Runtime Mobile / native mobile build in-hackathon, it's a classic time-sink with high failure risk. Running the same `.onnx` file via `onnxruntime-web` on a phone's browser gives you the identical "offline inference on a phone" demo beat with zero mobile toolchain risk.
  - Quick-start references: Microsoft's `onnxruntime-inference-examples` (script-tag quick start, load `.onnx`, run inference, done in one HTML file) and the official Next.js image-classification template (`classify-images-nextjs-github-template`) if you want a proper React app instead.
- Bundle the ONNX model's hash with every inference record — cheap, and gives you a real traceability primitive ("prove which model version made this decision").

### 1.6 Security — actually implement these, they're cheap and judges ask about them
- **Signed Agent Cards**: A2A supports TLS and JWT-based auth for controlling which agents may participate — use JWT bearer auth on agent-to-agent calls, don't leave it open.
- **Treat every other agent as untrusted by default** — this is literally the A2A project's own guidance: agents outside your direct control should be treated as potentially untrusted entities. Validate/sanitize any payload from another agent before acting on it.
- **VC signing key**: generate once, keep server-side only, never expose in any client bundle. If asked "what if the key leaks," have the answer ready (key rotation via new `did:key`, revocation list).
- **Input validation before inference**: reject malformed images/payloads before they hit the ONNX session — a bad input shouldn't be able to crash or manipulate the verifier.
- **Rate limiting on producer registration/submission** endpoints — even a naive in-memory token bucket is enough to say "we thought about abuse," which most teams won't.
- Don't claim end-to-end encryption or a security audit you haven't done — overclaiming security is worse than not mentioning it.

---

## 2. Theme A — Renewable Energy Intelligence

### 2.1 Idea options (ranked)
1. **Community Energy Trading Mesh** (top pick if this theme drops) — households/small producers list surplus via Producer Agents; a market-clearing Matchmaker Agent runs a double auction every N minutes; settlement issued as a VC "energy receipt" instead of a token. Differentiator: a real auction-clearing algorithm, and explicitly *not* reaching for a blockchain/token, which most competing teams will default to.
2. **Grid-Edge LLM Copilot** — same forecasting/dispatch mesh, plus a small local LLM (quantized, e.g. a small Gemma/Phi-class model) that narrates *why* a dispatch decision was made, in plain language, for a grid operator. Most teams show a dashboard; this shows a copilot that argues its case — strong differentiator, moderate extra build time.
3. **Digital Twin + RL Dispatcher** — only pick if someone on the team already has RL experience; do not learn RL live during the hackathon.
4. **Surplus-to-Electrolysis Router** (the original idea) — safe fallback, well-scoped, still credible.

### 2.2 Tech / repos
- `squoilin/MicroGrids` (MIT, Python/Pyomo) — library for sizing and dispatch of energy in microgrids: optimal sizing of batteries/generators/PV, optimal dispatch from different sources, LCOE calculation. Lift the dispatch math conceptually from here instead of writing an MILP solver from scratch under time pressure.
- `leejt489/microgrid-dispatch-simulator` — simulation loops for energy management/load dispatch in community microgrids with DERs, including receding-horizon control loops.
- **Avoid**: blockchain P2P energy-trading repos (`pranshugarg/Decentralized-Energy-Trading-using-Blockchain`, `ratankaliani/microgrid`) — mostly tokenization demos with no real market-clearing logic. A judge will ask "why blockchain here" and there's no good answer. This is your chance to visibly *not* do what other teams will do.
- Public datasets for a realistic demo feed: solar/load profiles from data.gov.in or Kaggle if you need synthetic-but-plausible time series.

---

## 3. Theme B — Circular Carbon Ecosystem

### 3.1 Idea options (ranked)
1. **Stubble-to-Value Agent Network** (top pick if this theme drops) — NASA FIRMS gives free, real, near-real-time satellite fire-detection data for crop burning (data available within 3 hours globally via MODIS/VIIRS). A Matchmaker Agent routes detected burn zones to nearby biochar/briquette processors; a Verifier Agent scores photo evidence of biochar quality with an ONNX vision model; the Registry issues a carbon credit as a VC. Unambiguously circular (waste stream → sequestered carbon → verified credit), and uses a real external live data feed, not synthetic data — that alone sets it apart.
2. **Industrial Byproduct Matchmaker** — general symbiosis marketplace: facilities publish byproduct streams (waste heat, CO2, O2, fly ash) and needs; a small bipartite-matching optimizer pairs them; verified matches earn "avoided emissions" VCs. Broader scope, same architecture.
3. **Battery Second-Life Router** — an ONNX state-of-health classifier scores degraded EV/storage batteries and routes them to second-life storage, recycling, or safe disposal. Good fallback if the statement is ambiguous between the two themes, since it's honestly amphibious (energy storage + circular material flow) rather than force-fit.
4. **(Original) ACV Verifier + BEE Registry for hydrogen** — weaker fit on its own for a *circularity* theme (it's accounting/certification, not a closed loop). Only use if paired with a genuine loop — e.g. add a Circularity Matchmaker Agent that pairs a producer's waste heat/O₂ output with a nearby industrial or agricultural user (real industrial symbiosis, not just accounting).

### 3.2 Important — known prior art, read before building
**`munish0838/parali`** is a real, already-built project doing almost exactly the stubble-burning idea: real-time stubble burning detection across 23 tracked districts in northern India, combining Sentinel-2 imagery, a fine-tuned Vision Language Model, and live NASA FIRMS data, built for a hackathon in May 2026. It even ONNX-exports its model with a stated satellite-deployment rationale (only transmit a small JSON alert per detected burn instead of a full imagery tile).

**Implication**: don't rebuild detection — that's solved. Their architecture stops at detection. Your differentiation is everything *after* detection that they don't have: the agent mesh, verified credit issuance, registry, and traceability layer. Pitch line: "detection is a solved problem — we built what happens after detection: verified, auditable biochar/carbon credits." Citing their approach as prior art in the pitch makes the team look aware of the space, not naive.

### 3.3 Tech / repos
- **NASA FIRMS** — direct REST API, free `MAP_KEY` registration, near-real-time fire detections from MODIS (Terra/Aqua) and VIIRS (S-NPP, NOAA-20, NOAA-21), data within 3 hours worldwide (60 seconds for US/Canada ultra-real-time). Official docs: `firms.modaps.eosdis.nasa.gov/api/`.
- `moorthynair/Automated-agriculture-fire-event-detector` — narrower, simpler reference implementation of pulling farm fire locations from FIRMS than Parali; easier to read in an hour if you just need the API pattern.
- Carbon accounting / registry references (for schema/methodology, not necessarily direct dependencies):
  - `thegreenwebfoundation/co2.js` — npm module for estimating carbon emissions from digital services; useful if any part of the pitch touches compute emissions.
  - `singularity-energy/open-grid-emissions` — tools for hourly generation/emissions data for US electric grids; good real-methodology reference for emissions math even if the raw data doesn't apply directly.
  - `Open-Earth-Foundation/OpenClimate` — data utility for tracking climate action, database/API for CO2 emissions down to specific sites (factories etc.), connected by geographic/business relationships — good conceptual model for the Registry Agent's data schema.
- **Avoid**: `hyperledger-labs/blockchain-carbon-accounting` — real and well-built, but Hyperledger Fabric setup is multi-day work you don't have. The VC + hash-chain combo gets you the same trust story in hours, not days.

---

## 4. Interfaces — build 3, keep each thin

Don't build three separate polished apps — three thin single-page views hitting the same backend:
1. **Producer/dispatcher dashboard** — forecast + dispatch/matching decision, one screen
2. **Verifier/auditor console** — evidence in, decision + VC out, the hash-chain view. This is the "wow" screen — invest the most polish here.
3. **Field/edge view** — the `onnxruntime-web` offline-inference demo, works on a phone browser, no native app needed
4. *(Optional 4th, only if time allows)* — a public registry/lookup view where anyone can paste a task ID and see the evidence→decision→credential chain

---

## 5. What's REAL vs SIMULATED — say this explicitly in the pitch

| Component | Status | Notes |
|---|---|---|
| A2A message passing, task lifecycle, Agent Cards | REAL | Built on official SDK/samples |
| ONNX export + server inference | REAL | |
| ONNX inference in browser (edge demo) | REAL | via onnxruntime-web |
| Hash-chained decision log | REAL | Trivial to implement correctly |
| W3C Verifiable Credential issuance | REAL | via did-jwt-vc, locally-generated did:key |
| Message queue (Kafka/NATS) | SIMULATED | In-memory/Redis, same interface shape, disclosed as such |
| Real mobile ONNX Runtime app | NOT ATTEMPTED | Deliberately substituted with browser inference |
| Production auth/infra hardening | PARTIAL | JWT on agent calls, input validation, rate limiting — real but minimal |
| Live external data feed (FIRMS, or grid/load data) | REAL where applicable | This is a differentiator most teams skip |

Being upfront about this table in the pitch is a strength, not a weakness — it signals engineering judgment.

---

## 6. 36-hour time budget (4-5 person team)

- **Hrs 0-1**: Read problem statement, confirm theme, pick idea from Section 2 or 3, assign owners
- **Hrs 1-8**: Agent skeleton + A2A message flow + in-memory queue (chassis from Section 1)
- **Hrs 8-16**: ONNX export/inference for the domain model (train or fine-tune/adapt a pretrained classifier — don't train from scratch if a usable pretrained base exists)
- **Hrs 16-22**: Hash chain + VC issuance
- **Hrs 22-30**: Three thin interfaces (Section 4)
- **Hrs 30-36**: Integration, bug fixing, demo script + rehearsal — do not skip this. This is where "polished" actually comes from, not from adding more features late.

Do not attempt to build both themes' ideas fully in parallel. Build the chosen theme's primary idea deep; only keep the other theme's config/schema ready as a fallback, not a fully built second UI.

---

## 7. Pitch narrative skeleton (for whoever presents)

1. Problem in one sentence, tied directly to the released statement
2. Why existing approaches (accounting-only / blockchain-heavy / centralized dashboards) fall short — this is where you mention Parali or blockchain energy-trading repos as "prior art we studied and deliberately didn't repeat"
3. Architecture in one diagram: Producer → Verifier → Registry, A2A messages, VC output
4. Live demo: submit evidence → watch task lifecycle → see hash-chained decision → see issued VC → query it back by task ID
5. The Section 5 table, shown briefly and honestly
6. What this becomes in production (real Kafka/NATS, real mobile ORT, hardened auth) — 30 seconds, not a roadmap slide marathon

---

## 8. Reference links

- A2A protocol org: https://github.com/a2aproject
- A2A samples: https://github.com/a2aproject/a2a-samples
- A2A JS SDK: https://github.com/a2aproject/a2a-js
- A2A Inspector: https://github.com/a2aproject/a2a-inspector
- did-jwt-vc: https://github.com/decentralized-identity/did-jwt-vc
- Veramo: https://github.com/decentralized-identity/veramo
- digitalbazaar/vc: https://github.com/digitalbazaar/vc
- ONNX Runtime inference examples: https://github.com/microsoft/onnxruntime-inference-examples
- ONNX Runtime Web Next.js template: https://github.com/microsoft/onnxruntime (see docs/tutorials/web)
- MicroGrids (dispatch): https://github.com/squoilin/MicroGrids
- microgrid-dispatch-simulator: https://github.com/leejt489/microgrid-dispatch-simulator
- Parali (stubble detection, prior art): https://github.com/munish0838/parali
- NASA FIRMS API docs: https://firms.modaps.eosdis.nasa.gov/api/
- Automated-agriculture-fire-event-detector: https://github.com/moorthynair/Automated-agriculture-fire-event-detector
- co2.js: https://github.com/thegreenwebfoundation/co2.js
- open-grid-emissions: https://github.com/singularity-energy/open-grid-emissions
- OpenClimate: https://github.com/Open-Earth-Foundation/OpenClimate
