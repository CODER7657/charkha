/**
 * One credit, end to end, against a running stack.
 *
 *   node scripts/e2e.mjs [baseUrl]
 *
 * Walks the whole chain the pitch describes - detection, match, field
 * evidence, verdict, issuance, retirement, trace - and checks each stage
 * produced what the next one needs.
 *
 * The evidence it submits is built the way the field view builds it: the
 * canary is computed by running the real model on the real tensor, so this
 * exercises the divergence check rather than stepping around it. What it
 * cannot do is hold a phone, which is why the field view still needs a human
 * pass on a real device.
 *
 * Exits non-zero on the first stage that fails.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import ort from "onnxruntime-node";
import { CANARY_PREFIX, CLASSES, canaryTensor } from "../agents/verifier/src/protocol.ts";
import { resolveModelFiles } from "../agents/verifier/src/modelFiles.ts";

const base = (process.argv[2] ?? "http://127.0.0.1:4000").replace(/\/$/, "");

let step = 0;
const ok = (msg) => console.log(`ok    ${++step}. ${msg}`);
const fail = (msg) => {
  console.error(`FAIL  ${msg}`);
  process.exit(1);
};

const call = async (pathname, init) => {
  let res;
  try {
    res = await fetch(`${base}${pathname}`, {
      ...init,
      // Only declare a JSON body when we actually send one - fastify rejects
      // content-type: application/json with an empty body.
      headers: init?.body ? { "content-type": "application/json", ...init?.headers } : { ...init?.headers },
      signal: AbortSignal.timeout(120_000),
    });
  } catch (err) {
    return fail(`${pathname} - ${err.message}`);
  }
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return fail(`${pathname} - not JSON: ${text.slice(0, 200)}`);
  }
  return { status: res.status, body };
};

const expectOk = async (pathname, init, what) => {
  const { status, body } = await call(pathname, init);
  if (status !== 200) fail(`${what}: HTTP ${status} ${JSON.stringify(body).slice(0, 260)}`);
  return body.output ?? body;
};

/* ---------- 0. the mesh ---------- */
const health = await expectOk("/api/health", undefined, "health");
const down = (health.agents ?? []).filter((a) => !a.up).map((a) => a.name);
if (down.length) fail(`agents down: ${down.join(", ")}`);
ok(`mesh healthy - ${health.agents.length} agents`);

/* ---------- 1. detection -> lots ---------- */
const ingest = await expectOk("/api/ingest", { method: "POST", body: JSON.stringify({}) }, "ingest");
ok(`ingest: ${ingest.fetched} fetched, ${ingest.lotsCreated} new lots, origin=${ingest.origin}`);
if (ingest.origin !== "live") {
  console.log(`      note: origin is "${ingest.origin}" - not the live feed. Do not claim live data.`);
}

/* ---------- 2. lots -> matches ---------- */
let match = (await expectOk("/api/match", { method: "POST", body: JSON.stringify({ maxRadiusKm: 60 }) }, "match"))
  .matches?.[0];

if (!match) {
  /* Everything already matched on a previous run. Reuse one rather than
     reporting a failure that is really an idempotent no-op. */
  const led = await expectOk("/api/ledger", undefined, "ledger");
  const task = (led.chain ?? []).find((r) => r.agent === "matchmaker")?.taskId;
  if (!task) fail("no matches now and none in the ledger - run ingest first");
  const trace = await expectOk(`/api/trace/${task}`, undefined, "trace for a past match");
  match = trace.match;
  if (!match) fail("could not recover a match from the ledger");
  ok(`reusing match ${match.matchId} (all current lots already matched)`);
} else {
  ok(`match ${match.matchId} - ${match.distanceKm} km, ${match.transportKgCo2e} kgCO2e`);
}

/* The lot behind the match, for its feedstock.
 *
 * Guessing it is how this script failed first time, on the same
 * `feedstock_matches_lot` check @Ayush3422 hit driving the UI by hand. The
 * operator picks from a dropdown with no idea what the lot says and only finds
 * out after a photo and a full inference run. That is the trap; the field view
 * should preselect from the match for exactly this reason. */
let lotFeedstock = "paddy_straw";
{
  const led = await expectOk("/api/ledger", undefined, "ledger");
  const task = (led.chain ?? []).find((r) => r.agent === "matchmaker")?.taskId;
  if (task) {
    const t = await expectOk(`/api/trace/${task}`, undefined, "trace for the lot");
    if (t.lot?.feedstock) {
      lotFeedstock = t.lot.feedstock;
      ok(`lot ${t.lot.lotId} is ${lotFeedstock} - using it rather than guessing`);
    }
  }
}

/* ---------- 3. field evidence, built the way the field view builds it ---------- */
const files = resolveModelFiles();
if (!files) fail("no .onnx model found - the field view would fail the same way");
const modelBytes = readFileSync(files.onnx);
const modelHash = createHash("sha256").update(modelBytes).digest("hex");
const meta = JSON.parse(readFileSync(files.sidecar, "utf8"));

const session = await ort.InferenceSession.create(files.onnx);
const inputName = session.inputNames[0];
const outputName = session.outputNames[0];

const run = async (tensor) => {
  const out = await session.run({
    [inputName]: new ort.Tensor("float32", tensor, [1, 3, 224, 224]),
  });
  const probs = Array.from(out[outputName].data);
  return Object.fromEntries(CLASSES.map((c, i) => [c, probs[i]]));
};

const imageHash = createHash("sha256").update(`charkha-e2e-${Date.now()}`).digest("hex");

/* A photo we never send, standing in for well-formed char.
 *
 * The committed baseline is a documented colour heuristic - dark reads as good
 * char, grey as poor, bright as not char - so a dark tensor is what a real
 * photo of good biochar would look like to it. The point is the pipeline, not
 * the score: once a trained model replaces the baseline this constant is what
 * changes, and nothing else here does. */
const photoTensor = new Float32Array(3 * 224 * 224).fill(-1.2);
const photo = await run(photoTensor);
const canary = await run(canaryTensor(imageHash));
ok(`inference: photo top=${Object.entries(photo).sort((a, b) => b[1] - a[1])[0][0]}, canary computed`);

const evidence = {
  evidenceId: `evi_e2e_${Date.now().toString(36)}`,
  matchId: match.matchId,
  at: { lat: match.at?.lat ?? 30.9, lon: match.at?.lon ?? 75.85 },
  capturedAt: new Date().toISOString(),
  imageHash,
  modelHash,
  modelVersion: meta.version ?? "0.1.0-baseline",
  clientScores: {
    ...photo,
    ...Object.fromEntries(Object.entries(canary).map(([k, v]) => [`${CANARY_PREFIX}${k}`, v])),
  },
  batch: {
    pyrolysisPeakTempC: 520,
    residenceTimeMin: 45,
    feedstock: lotFeedstock,
    outputTonnes: Math.min(1.2, (match.assignedTonnes ?? 4) * 0.28),
    hcOrgRatio: 0.4,
  },
};

const bytes = Buffer.byteLength(JSON.stringify(evidence));
if (JSON.stringify(evidence).match(/base64|data:image/i)) fail("evidence carries image data");
ok(`evidence built - ${bytes} bytes, hash only, no image`);

/* ---------- 4. verdict ---------- */
const verdict = await expectOk("/api/evidence", { method: "POST", body: JSON.stringify(evidence) }, "verifyEvidence");
const failedChecks = (verdict.methodologyChecks ?? []).filter((c) => !c.passed);
ok(
  `verdict: ${verdict.verdict} - ${verdict.predictedClass} ` +
    `(${(verdict.methodologyChecks ?? []).length - failedChecks.length}/${(verdict.methodologyChecks ?? []).length} checks passed)`,
);
if (verdict.verdict !== "accepted") {
  console.log(`      reasons: ${(verdict.reasons ?? []).join("; ")}`);
  if (failedChecks.length) console.log(`      failed: ${failedChecks.map((c) => c.check).join(", ")}`);
  fail("evidence not accepted - issuance cannot proceed");
}

/* ---------- 5. issuance ---------- */
const issued = await expectOk(
  "/api/credits/issue",
  { method: "POST", body: JSON.stringify({ matchId: match.matchId, evidenceId: evidence.evidenceId }) },
  "issueCredit",
);
const credit = issued.credit;
ok(
  `credit ${credit.creditId} - ${credit.netTonnesCo2e} tCO2e ` +
    `(gross ${credit.breakdown.grossSequestrationTco2e}, transport -${credit.breakdown.transportDebitTco2e}, process -${credit.breakdown.processDebitTco2e})`,
);
ok(`holder ${credit.holder}, status-list index ${credit.statusListIndex}`);

/* ---------- 6. the guards ---------- */
const dup = await call("/api/credits/issue", {
  method: "POST",
  body: JSON.stringify({ matchId: match.matchId, evidenceId: evidence.evidenceId }),
});
if (dup.status !== 400) fail(`double issuance returned ${dup.status}, expected 400`);
ok("double issuance refused with 400");

const wrongHolder = await call("/api/credits/retire", {
  method: "POST",
  body: JSON.stringify({ creditId: credit.creditId, retiredBy: "not-the-holder", reason: "test" }),
});
if (wrongHolder.status !== 400) fail(`wrong-holder retirement returned ${wrongHolder.status}, expected 400`);
ok("retirement by a non-holder refused with 400");

/* ---------- 7. retirement, and its idempotency ---------- */
const retired = await expectOk(
  "/api/credits/retire",
  { method: "POST", body: JSON.stringify({ creditId: credit.creditId, retiredBy: credit.holder, reason: "e2e" }) },
  "retireCredit",
);
if (retired.credit.status !== "retired") fail(`status is ${retired.credit.status}, expected retired`);
ok("credit retired");

const again = await expectOk(
  "/api/credits/retire",
  { method: "POST", body: JSON.stringify({ creditId: credit.creditId, retiredBy: credit.holder, reason: "e2e" }) },
  "retireCredit (again)",
);
if (again.credit.creditId !== credit.creditId) fail("second retirement returned a different record");
ok("second retirement is idempotent");

/* ---------- 8. the thread a judge follows ---------- */
const ledger = await expectOk("/api/ledger", undefined, "ledger");
if (!ledger.verdict.valid) fail(`chain reports broken at seq ${ledger.verdict.brokenAtSeq}`);
ok(`chain valid - ${ledger.chain.length} decisions`);

const issueTask = ledger.chain.find((r) => r.agent === "registry" && r.action === "issueCredit")?.taskId;
if (!issueTask) fail("no issuance decision in the ledger");
const trace = await expectOk(`/api/trace/${issueTask}`, undefined, "trace");
for (const part of ["match", "credit"]) {
  if (!trace[part]) fail(`trace is missing ${part}`);
}
ok(`trace ${issueTask} resolves match and credit`);

console.log(`\nend to end passed: ${credit.netTonnesCo2e} tCO2e issued, verified and retired.`);
