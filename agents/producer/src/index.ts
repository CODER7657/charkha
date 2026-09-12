import { loadEnv, buildAgentCard, startAgentServer } from "@charkha/a2a";
import { ListLotsInput, IngestBurnsInput, DeclareWasteInput } from "@charkha/core";
import { AGENT_NAME, AGENT_VERSION } from "./card.ts";
import { ingestBurns } from "./skills/ingestBurns.ts";
import { listLots } from "./skills/listLots.ts";
import { declareWaste } from "./skills/declareWaste.ts";

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
    /* The second supply path. FIRMS finds waste that is burning, so a
       municipality's landfilled organic waste and a factory's skip are
       invisible to it - declaration is how those generators enter at all.
       The card says "declared" out loud because the card is what an auditor
       fetches to see what this agent claims it can do. */
    { id: "declareWaste", name: "Declare waste", description: "Record waste declared by a municipality, ward or industrial generator as a residue lot, marked as declared rather than satellite-detected.", tags: ["declare", "municipal", "industrial"] },
  ],
});

await startAgentServer({
  card,
  port: PORT,
  skills: {
    ingestBurns: { input: IngestBurnsInput, run: ingestBurns },
    listLots: { input: ListLotsInput, run: listLots },
    declareWaste: { input: DeclareWasteInput, run: declareWaste },
  },
});
