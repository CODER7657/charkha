import { loadEnv } from "@charkha/a2a";
import {
  DEFAULT_BBOX,
  DEFAULT_SOURCE,
  buildFirmsUrl,
  looksLikeCsv,
  parseCsv,
  planIngest,
} from "./firms.ts";

/* ------------------------------------------------------------------ *
 * OWNER: Harsh
 *
 * What do FIRMS_BBOX and FIRMS_DAY_RANGE actually buy us?
 *
 *   pnpm -F @charkha/agent-producer coverage
 *
 * Detections depend on what genuinely burned in the last N days inside the
 * bbox. If the belt is quiet on the day we present, the opening shot of the
 * demo is a nearly empty map - and the time to find out which settings fix
 * that is now, not while a judge is watching.
 *
 * This measures what INGEST WOULD CREATE, not raw CSV rows: it runs the same
 * planIngest() the skill runs, so the "lots" column is the number of markers
 * that would actually appear on the map.
 *
 * Deliberately NO cache fallback. A measurement that quietly answered from a
 * stale file would be worse than no measurement, so this fails loudly without
 * a live key.
 * ------------------------------------------------------------------ */

loadEnv();

/** The default belt, and a wider box for comparison. west,south,east,north. */
const BELT = DEFAULT_BBOX;
const WIDE = "72.0,28.0,79.0,33.0";

type Probe = { label: string; bbox: string; dayRange: number };

const PROBES: Probe[] = [
  { label: "belt  1d", bbox: BELT, dayRange: 1 },
  { label: "belt  2d  <- current default", bbox: BELT, dayRange: 2 },
  { label: "belt  5d", bbox: BELT, dayRange: 5 },
  { label: "belt 10d  <- max", bbox: BELT, dayRange: 10 },
  { label: "wide  2d", bbox: WIDE, dayRange: 2 },
  { label: "wide 10d  <- max", bbox: WIDE, dayRange: 10 },
];

type Row = {
  label: string;
  rows: number;
  usable: number;
  lowConf: number;
  dupes: number;
  lots: number;
  tonnes: number;
  offBelt: number;
};

const measure = async (mapKey: string, probe: Probe): Promise<Row> => {
  const res = await fetch(
    buildFirmsUrl({
      mapKey,
      source: process.env["FIRMS_SOURCE"] ?? DEFAULT_SOURCE,
      bbox: probe.bbox,
      dayRange: probe.dayRange,
    }),
    { headers: { accept: "text/csv" }, signal: AbortSignal.timeout(60_000) },
  );
  if (!res.ok) throw new Error(`${probe.label}: FIRMS returned HTTP ${res.status}`);

  const csv = await res.text();
  if (!looksLikeCsv(csv)) {
    throw new Error(`${probe.label}: not CSV - ${csv.slice(0, 120).replace(/\s+/g, " ").trim()}`);
  }

  const parsed = parseCsv(csv);
  const plan = planIngest(parsed, new Set());

  return {
    label: probe.label,
    rows: parsed.length,
    usable: plan.parsed,
    lowConf: plan.skippedLowConfidence,
    dupes: plan.skippedDuplicate,
    lots: plan.lots.length,
    tonnes: Math.round(plan.lots.reduce((sum, l) => sum + l.tonnes, 0)),
    /* A detection further than DISTRICT_MAX_KM from any district centroid we
       know gets district=null and a prod_unknown producer. That is the honest
       cost of widening the bbox: more markers, less able to say where they
       are. */
    offBelt: plan.lots.filter((l) => l.district === null).length,
  };
};

const pad = (s: string | number, n: number) => String(s).padStart(n);

const main = async (): Promise<void> => {
  const mapKey = process.env["FIRMS_MAP_KEY"]?.trim();
  if (!mapKey || mapKey === "replace_me") {
    console.error(
      "FIRMS_MAP_KEY is not set.\n" +
        "Free key, one registration round-trip: https://firms.modaps.eosdis.nasa.gov/api/map_key/\n" +
        "Then put it in .env and re-run. This tool deliberately has no cache fallback.",
    );
    process.exit(1);
  }

  console.log(`source ${process.env["FIRMS_SOURCE"] ?? DEFAULT_SOURCE}   ${new Date().toISOString()}`);
  console.log(`belt ${BELT}`);
  console.log(`wide ${WIDE}\n`);
  console.log("probe                        rows  usable  lowConf  dupes   lots  tonnes  offBelt");
  console.log("-".repeat(84));

  const results: Row[] = [];
  for (const probe of PROBES) {
    try {
      const r = await measure(mapKey, probe);
      results.push(r);
      console.log(
        `${r.label.padEnd(26)} ${pad(r.rows, 5)} ${pad(r.usable, 7)} ${pad(r.lowConf, 8)} ` +
          `${pad(r.dupes, 6)} ${pad(r.lots, 6)} ${pad(r.tonnes, 7)} ${pad(r.offBelt, 8)}`,
      );
    } catch (err) {
      console.log(`${probe.label.padEnd(26)} FAILED: ${err instanceof Error ? err.message : String(err)}`);
    }
    // 5000 calls per 10 minutes is a generous budget; still, do not hammer it.
    await new Promise((r) => setTimeout(r, 1000));
  }

  const current = results.find((r) => r.label.includes("current default"));
  if (current) {
    console.log(
      `\nCurrent default puts ${current.lots} lots (${current.tonnes} t) on the map. ` +
        (current.lots === 0
          ? "That is an EMPTY opening shot - widen the day range or the bbox."
          : current.lots < 10
            ? "That is thin for an opening shot - consider a wider day range."
            : "That is a healthy opening shot."),
    );
  }
};

await main();
