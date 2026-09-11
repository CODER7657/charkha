import "dotenv/config";
import { buildAgentCard, startAgentServer } from "@charkha/a2a";
import { IssueCreditInput, RetireCreditInput } from "@charkha/core";
import { issueCredit } from "./skills/issueCredit.ts";
import { retireCredit } from "./skills/retireCredit.ts";

const PORT = Number(process.env["REGISTRY_PORT"] ?? 4004);

const card = buildAgentCard({
  name: "Charkha Registry",
  description: "Computes net sequestered tonnes, issues the result as a W3C Verifiable Credential, and retires credits against a status list.",
  url: `${process.env["REGISTRY_URL"] ?? `http://localhost:${PORT}`}/a2a`,
  skills: [
    { id: "issueCredit", name: "Issue credit", description: "Compute net tCO2e for a verified batch and issue a Verifiable Credential.", tags: ["credential", "carbon"] },
    { id: "retireCredit", name: "Retire credit", description: "Retire an issued credit so it can never be double-sold.", tags: ["credential"] },
  ],
});

await startAgentServer({
  card,
  port: PORT,
  skills: {
    issueCredit: { input: IssueCreditInput, run: issueCredit },
    retireCredit: { input: RetireCreditInput, run: retireCredit },
  },
});
