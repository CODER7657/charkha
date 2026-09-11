import { loadEnv, buildAgentCard, startAgentServer } from "@charkha/a2a";
import { VerifyEvidenceInput } from "@charkha/core";
import { appendDecision } from "@charkha/db/ledger";
import { makeVerifyEvidence } from "./skills/verifyEvidence.ts";
import { getModel, loadModel } from "./onnx.ts";
import { claimEvidence, findMatch, findPrior, saveVerification } from "./store.ts";

loadEnv();

const PORT = Number(process.env["VERIFIER_PORT"] ?? 4003);
const BASE_URL = process.env["VERIFIER_URL"] ?? `http://localhost:${PORT}`;

const card = buildAgentCard({
  name: "Charkha Verifier",
  description: "Scores field evidence of biochar production against methodology checks and returns an auditable verdict with the model hash.",
  url: `${BASE_URL}/a2a`,
  skills: [
    { id: "verifyEvidence", name: "Verify field evidence", description: "Score char quality and validate pyrolysis batch parameters.", tags: ["ml", "verification"] },
  ],
});

await loadModel();

const verifyEvidence = makeVerifyEvidence({
  model: getModel,
  agentCardId: `${BASE_URL}/.well-known/agent-card.json`,
  findMatch,
  findPrior,
  claimEvidence,
  appendDecision,
  saveVerification,
  now: () => new Date(),
});

await startAgentServer({
  card,
  port: PORT,
  skills: { verifyEvidence: { input: VerifyEvidenceInput, run: verifyEvidence } },
  routes: (app) => {
    // Lets the field view and the audit console show which model is live.
    app.get("/model", (_req, res) => {
      const m = getModel();
      res.json({ version: m.version, sha256: m.hash, loaded: m.loaded });
    });
  },
});
