# Demo runbook — one credit, end to end

The exact sequence, in order, with the output you should see at each step. Built
from the first complete local run (issue #16), so every number here was produced
by the real stack rather than imagined.

**Read the failure modes at the bottom before you run it on stage.** Every one of
them bit during the local pass.

Set this once, then every command below works as written:

```bash
BASE=https://your-host            # the deployed origin, or http://127.0.0.1:4000 locally
```

Use `127.0.0.1`, never `localhost`, for anything you run from a shell — see
failure mode 4.

---

## 0. Is the mesh actually up

```bash
curl -s $BASE/api/health
```

Expect `"ok":true` and all four agents `up`. If any is down, stop here — nothing
below will make sense, and the tab-bar dots in the UI are showing the same thing.

## 1. Detection → lots (producer)

```bash
curl -s -X POST $BASE/api/ingest
```

Expect something like `{"fetched":23,"newDetections":22,"lotsCreated":22}`.

`fetched` coming back as exactly **22** with **0 new** on a first run is the tell
that you are serving the bundled sample rather than live NASA data. A live fetch
also writes a file into `data/firms-cache/`; check that if you want certainty.

## 2. Lots → matches (matchmaker)

```bash
curl -s -X POST $BASE/api/match -H 'content-type: application/json' -d '{"maxRadiusKm":60}'
```

Expect 8-ish matches. **Keep the first `matchId` and note its `lotId`** — you need
both in the next step. The `rationale` string is worth reading aloud; it says why
that unit won.

Then find the lot's feedstock, because the field form has to agree with it:

```bash
curl -s "$BASE/api/lots" | grep -o '"feedstock":"[a-z_]*"' | head
```

## 3. Field capture (phone, in the browser)

Open `$BASE/#field` on the phone. It must be **https** — the camera and WebGPU
need a secure context.

1. Wait for the model line to appear (`model 0.1.0-baseline · sha256 …`). Nothing
   works before that.
2. Take the photo. You should get a class and a timing — `good_char 98.9%, 39 ms`.
3. Fill the batch: paste the `matchId`, set **feedstock to whatever the lot says**,
   peak temp `520`, residence `45`, output `3.2`, H/C `0.32`, and the lot's
   coordinates.
4. Check the line above the button: `Exactly what leaves this device · ~690 bytes,
   no image`. That sentence is the privacy claim, and it is worth pointing at.
5. Submit.

Expect **Accepted**, with `canary attested: browser and server agree within
1.18e-8` and five ticked methodology checks. The canary line is the proof that
on-device inference is real and not a claim — say it out loud.

## 4. Issue the credit (registry)

Get the `evidenceId` the verifier just stored:

```bash
curl -s $BASE/api/trace/<taskId-from-step-3> | head -c 400
```

The registry reads the verdict from the database, so the request only needs the
ids — but while `IssueCreditInput` still carries `verification`, you must send the
**stored row byte for byte** (failure mode 3). Easiest honest path on stage is the
operator view; from a shell, build the body in Node rather than copy-pasting JSON
through a terminal.

```bash
curl -s -X POST $BASE/api/credits/issue -H 'content-type: application/json' \
  -d '{"matchId":"<matchId>","evidenceId":"<evidenceId>","verification":<exact stored row>}'
```

Expect a credit: `netTonnesCo2e` around **4.37**, with the breakdown showing gross,
transport debit and process debit. Every term traces to a cited factor.

**The refusal worth showing.** Post the same request with `"verdict":"accepted"`
for evidence the verifier did not accept:

```
refusing to issue: verification verdict is "needs_review", not "accepted"
```

That is thirty seconds and it lands harder than any slide: a judge watches us fail
to forge our own credential.

## 5. Retire it, twice

```bash
curl -s -X POST $BASE/api/credits/retire -H 'content-type: application/json' \
  -d '{"creditId":"<creditId>","retiredBy":"acme-offsets-ltd","reason":"voluntary retirement"}'
```

Run it **twice**. Both return `"status":"retired"` with the same record, and the
ledger gains exactly one `retireCredit` entry. Retirement is idempotent and
terminal; the second call is the demonstration.

## 6. The thread (audit console)

Open `$BASE/#audit`. **Reload it first** — and if you have had it open while doing
everything above, reload again.

1. Paste the issuance task id into the lookup box, press **Trace**.
2. You should get lot → match → evidence → verification → credential in one
   thread, the credential panel reading **RETIRED**.
3. Press **Verify chain in this browser** → `CHAIN VALID — N records re-hashed in
   this browser`. The verdict is the viewer's, not ours.
4. Press **Verify signature** → `signature valid`, against the issuer DID resolved
   locally.
5. **Tamper demo:** press it, edit one `action` or `confidence`, verify again →
   `BROKEN AT seq N — record content does not match its hash`, and everything
   after it greys out. Press **Restore** to put it back.

The chain should read producer → matchmaker → verifier → registry → registry, each
record pointing at the one before.

---

## Failure modes, all of them hit during the local run

1. **Field submission rejected on `feedstock_matches_lot`.** The feedstock you
   picked does not match the lot. Correct behaviour, but the form cannot tell you
   the lot's value — look it up in step 2 before you touch the phone.
2. **`pnpm seed` fails with `ERR_MODULE_NOT_FOUND`.** Fixed, but if you are on an
   older checkout, that is why.
3. **`the verification in this request does not match the one on record`.** Your
   copy of the stored verification differs — usually an encoding mangle of the
   degree sign in `520 °C` when JSON goes through a terminal. Build the body in
   Node, or issue from the operator view.
4. **`ECONNREFUSED ::1:4000`.** Node resolves `localhost` to IPv6 and the gateway
   binds IPv4. Use `127.0.0.1`.
5. **The console shows an old ledger.** It now refreshes when the tab regains
   focus, but a hard reload is the guaranteed fix. Never trust a console that has
   been open since before the run.
6. **Blank field-capture screen.** Not https, so no secure context. There is no
   workaround; it has to be the real hostname with TLS.

## What is honestly simulated

Say these before a judge finds them:

- retirement checks a `retiredBy` field against the credit's holder — a field
  check, not a proven identity. Production needs a signed holder presentation.
- the in-memory queue sits behind a broker-shaped interface; there is no Kafka.
- the char-quality model is a baseline trained on a small set, not a production
  classifier. The dual-runtime canary proves the *same* model ran in both places,
  which is the claim we actually make.
