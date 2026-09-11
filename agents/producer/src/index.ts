import { loadEnv, buildAgentCard, startAgentServer } from "@charkha/a2a";
import { ListLotsInput, IngestBurnsInput } from "@charkha/core";
import { AGENT_NAME, AGENT_VERSION } from "./card.ts";
import { ingestBurns } from "./skills/ingestBurns.ts";
import { listLots } from "./skills/listLots.ts";

loadEnv();

const PORT = Number(process.env["PRODUCER_PORT"] ?? 4001);

const card = buildAgentCard({
  name: AGENT_NAME,
  version: AGENT_VERSION,
  description: "Publishes crop-residue lots available for collection, seeded from satellite burn detections and registered plots.",
  url: `${process.env["PRODUCER_URL"] ?? `http://localhost:${PORT}`}/a2a`,
  skills: [
    { id: "ingestBurns", name: "Ingest burn detections", description: "Pull near-real-time fire detections and turn them into residue lots.", tags: ["ingest", "satellite"] },
    { id: "listLots", name: "List residue lots", description: "Return residue lots, optionally filtered by district and status.", tags: ["query"] },
  ],
});

await startAgentServer({
  card,
  port: PORT,
  skills: {
    ingestBurns: { input: IngestBurnsInput, run: ingestBurns },
    listLots: { input: ListLotsInput, run: listLots },
  },
});
