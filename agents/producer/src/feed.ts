import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs/promises";
import { DEFAULT_SOURCE, buildFirmsUrl, looksLikeCsv } from "./firms.ts";

/* ------------------------------------------------------------------ *
 * OWNER: Harsh
 *
 * Getting the CSV, wherever it has to come from.
 *
 * Order: live feed -> newest cached response -> bundled sample. The demo
 * must survive venue wifi, a missing key and a NASA outage, in that order
 * of likelihood. Every raw response we do get is written to the cache, so
 * the fallback gets better every time we run online.
 *
 * The only outbound call in Charkha is the read-only GET in here.
 * ------------------------------------------------------------------ */

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");

export const cacheDir = (): string =>
  process.env["FIRMS_CACHE_DIR"] ?? path.join(repoRoot, "data", "firms-cache");

/** Committed so a clean clone has something to draw before it has a key. */
export const fixturePath = (): string =>
  path.join(here, "..", "fixtures", "firms-sample.csv");

export type FeedOrigin = "live" | "cache" | "fixture";

export type FeedResult = {
  csv: string;
  origin: FeedOrigin;
  /** Human-readable, goes straight to ctx.progress() and into the UI. */
  note: string;
};

const readNewestCache = async (): Promise<{ csv: string; file: string } | null> => {
  const dir = cacheDir();
  let names: string[];
  try {
    names = (await fs.readdir(dir)).filter((n) => n.endsWith(".csv"));
  } catch {
    return null;
  }
  // Filenames are ISO timestamps, so lexical order is chronological order.
  const newest = names.sort().at(-1);
  if (newest === undefined) return null;
  try {
    return { csv: await fs.readFile(path.join(dir, newest), "utf8"), file: newest };
  } catch {
    return null;
  }
};

const writeCache = async (csv: string): Promise<void> => {
  const dir = cacheDir();
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  try {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, `${stamp}.csv`), csv, "utf8");
  } catch {
    // A cache we could not write is not a reason to fail an ingest.
  }
};

const readFixture = async (): Promise<string | null> => {
  try {
    return await fs.readFile(fixturePath(), "utf8");
  } catch {
    return null;
  }
};

/** Live feed only, no fallbacks. Separated so the fallback logic stays readable. */
const fetchLive = async (args: {
  mapKey: string;
  source?: string;
  bbox?: string;
  dayRange?: number;
  timeoutMs: number;
}): Promise<string> => {
  const res = await fetch(buildFirmsUrl(args), {
    method: "GET",
    signal: AbortSignal.timeout(args.timeoutMs),
    headers: { accept: "text/csv" },
  });
  if (!res.ok) throw new Error(`FIRMS returned HTTP ${res.status}`);
  const csv = await res.text();
  // FIRMS answers a bad key or a blown quota with 200 and a plain-text
  // message. Treat anything that is not a CSV header as a failure.
  if (!looksLikeCsv(csv)) {
    throw new Error(`FIRMS returned a non-CSV body: ${csv.slice(0, 120).replace(/\s+/g, " ").trim()}`);
  }
  return csv;
};

const fallback = async (reason: string): Promise<FeedResult> => {
  const cached = await readNewestCache();
  if (cached) {
    return { csv: cached.csv, origin: "cache", note: `${reason}; using cached response ${cached.file}` };
  }
  const fixture = await readFixture();
  if (fixture) {
    return { csv: fixture, origin: "fixture", note: `${reason}; no cache yet, using the bundled sample feed` };
  }
  // Nothing to show. Callers surface this rather than crashing the agent.
  return { csv: "", origin: "fixture", note: `${reason}; no cache and no bundled sample available` };
};

/**
 * Never throws. An ingest that cannot reach NASA still returns the best CSV
 * we have and says plainly where it came from - the operator view renders
 * that sentence, so we are never quietly showing stale data as if it were live.
 */
export const loadFirmsCsv = async (args: {
  bbox?: string;
  dayRange?: number;
  timeoutMs?: number;
} = {}): Promise<FeedResult> => {
  const mapKey = process.env["FIRMS_MAP_KEY"]?.trim();
  if (!mapKey || mapKey === "replace_me") {
    return fallback("FIRMS_MAP_KEY is not set");
  }

  const source = process.env["FIRMS_SOURCE"];
  const bbox = args.bbox ?? process.env["FIRMS_BBOX"];
  const dayRange = args.dayRange ?? Number(process.env["FIRMS_DAY_RANGE"] ?? 2);

  try {
    const csv = await fetchLive({
      mapKey,
      ...(source ? { source } : {}),
      ...(bbox ? { bbox } : {}),
      dayRange,
      timeoutMs: args.timeoutMs ?? 15_000,
    });
    await writeCache(csv);
    return { csv, origin: "live", note: `live FIRMS feed, ${source ?? DEFAULT_SOURCE}, ${dayRange}d` };
  } catch (err) {
    return fallback(err instanceof Error ? err.message : String(err));
  }
};
