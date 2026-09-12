import { loadEnv, buildAgentCard, startAgentServer } from "@charkha/a2a";
import { ListLotsInput, IngestBurnsInput, DeclareWasteInput } from "@charkha/core";
import { AGENT_NAME, AGENT_VERSION } from "./card.ts";
import { DEFAULT_BBOX, DEFAULT_DAY_RANGE, DEFAULT_SOURCE, EXCLUDED } from "./firms.ts";
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
  routes: (app) => {
    /**
     * What area this host actually pulls, reported by the only process that
     * can know it.
     *
     * The Provenance screen was reading FIRMS_BBOX straight out of the
     * gateway's environment, which is right for the box but silent about the
     * exclusions - so after #87 the deployed system was dropping every
     * detection in one rectangle and nothing anywhere said so. Rule 7 is that
     * a number a reader sees has to carry where it came from, and "the area
     * we cover" is a number like any other.
     *
     * Reported from the producer's own constants rather than copied into the
     * gateway, for the same reason dayRange is not copied: a second copy is
     * the same drift with extra steps. The gateway asks, exactly as it asks
     * the verifier for its model and the registry for its DID.
     */
    app.get("/coverage", (_req, res) => {
      res.json({
        source: process.env["FIRMS_SOURCE"] ?? DEFAULT_SOURCE,
        bbox: process.env["FIRMS_BBOX"] ?? DEFAULT_BBOX,
        bboxIsDefault: !process.env["FIRMS_BBOX"],
        dayRange: process.env["FIRMS_DAY_RANGE"] ? Number(process.env["FIRMS_DAY_RANGE"]) : DEFAULT_DAY_RANGE,
        excluded: EXCLUDED.map((b) => ({
          name: b.name,
          bbox: `${b.west},${b.south},${b.east},${b.north}`,
        })),
      });
    });
  },
});
