import { loadEnv, buildAgentCard, startAgentServer } from "@charkha/a2a";
import { RunMatchingInput, ListUnitsInput } from "@charkha/core";
import { runMatching } from "./skills/runMatching.ts";
import { listUnits } from "./skills/listUnits.ts";

loadEnv();

const PORT = Number(process.env["MATCHMAKER_PORT"] ?? 4002);

const card = buildAgentCard({
  name: "Charkha Matchmaker",
  description: "Assigns residue lots to nearby conversion units under capacity and radius constraints, debiting transport emissions.",
  url: `${process.env["MATCHMAKER_URL"] ?? `http://localhost:${PORT}`}/a2a`,
  skills: [
    { id: "runMatching", name: "Run matching round", description: "Assign listed lots to conversion units and return the matches.", tags: ["optimisation", "logistics"] },
    { id: "listUnits", name: "List conversion units", description: "Return registered conversion units, optionally filtered by accepted feedstock.", tags: ["query"] },
  ],
});

await startAgentServer({
  card,
  port: PORT,
  skills: {
    runMatching: { input: RunMatchingInput, run: runMatching },
    listUnits: { input: ListUnitsInput, run: listUnits },
  },
});
