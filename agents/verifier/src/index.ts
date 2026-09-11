import { loadEnv, buildAgentCard, startAgentServer } from "@charkha/a2a";
import { VerifyEvidenceInput } from "@charkha/core";
import { verifyEvidence } from "./skills/verifyEvidence.ts";
import { loadModel } from "./onnx.ts";

loadEnv();

const PORT = Number(process.env["VERIFIER_PORT"] ?? 4003);

const card = buildAgentCard({
  name: "Charkha Verifier",
  description: "Scores field evidence of biochar production against methodology checks and returns an auditable verdict with the model hash.",
  url: `${process.env["VERIFIER_URL"] ?? `http://localhost:${PORT}`}/a2a`,
  skills: [
    { id: "verifyEvidence", name: "Verify field evidence", description: "Score char quality and validate pyrolysis batch parameters.", tags: ["ml", "verification"] },
  ],
});

await loadModel();

await startAgentServer({
  card,
  port: PORT,
  skills: { verifyEvidence: { input: VerifyEvidenceInput, run: verifyEvidence } },
});
