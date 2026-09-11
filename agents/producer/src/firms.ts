import type { BurnDetection, FeedstockClass, GeoPoint, ResidueLot } from "@charkha/core";
import { haversineKm } from "@charkha/core";

/* ------------------------------------------------------------------ *
 * OWNER: Harsh
 *
 * Everything in this file is pure: CSV in, normalised rows out. No fs, no
 * network, no database. That is deliberate - it is the part with all the
 * assumptions in it, so it is the part that has to be cheap to test.
 *
 * The live fetch and the cache live next door in feed.ts.
 * ------------------------------------------------------------------ */

/** west,south,east,north - the order the FIRMS area API expects. */
export const DEFAULT_BBOX = "73.8,29.5,77.5,32.2";
export const DEFAULT_SOURCE = "VIIRS_SNPP_NRT";
export const DEFAULT_DAY_RANGE = 2;

/**
 * https://firms.modaps.eosdis.nasa.gov/api/area/csv/{MAP_KEY}/{SOURCE}/{bbox}/{dayRange}
 * Read-only GET, public data in. Nothing of ours goes out.
 */
/**
 * west,south,east,north - four plain numbers. Checked rather than escaped,
 * because the commas have to survive into the path (see below) and a bbox is
 * the one part of this URL that comes from configuration.
 */
const BBOX_RE = /^-?\d+(?:\.\d+)?(?:,-?\d+(?:\.\d+)?){3}$/;

export const buildFirmsUrl = (args: {
  mapKey: string;
  source?: string;
  bbox?: string;
  dayRange?: number;
}): string => {
  const source = args.source || DEFAULT_SOURCE;
  const bbox = args.bbox || DEFAULT_BBOX;
  const dayRange = Math.trunc(args.dayRange ?? DEFAULT_DAY_RANGE);

  /* The bbox goes in LITERALLY, commas and all. percent-encoding them gives
     HTTP 400 "Invalid area. Expects: [west,south,east,north]" - FIRMS parses
     this path segment itself and does not decode it first. That bug made every
     live fetch fail and silently fall through to the cache, which is exactly
     the kind of failure a fallback hides. Verified against the live endpoint:
     encoded 400s, literal returns CSV.

     Validated instead of escaped, so a stray "/" in FIRMS_BBOX cannot bend the
     request onto a different path. */
  if (!BBOX_RE.test(bbox)) {
    throw new Error(`FIRMS_BBOX must be "west,south,east,north" as four numbers; got "${bbox}"`);
  }
  if (!Number.isFinite(dayRange) || dayRange < 1) {
    throw new Error(`FIRMS day range must be a positive integer; got "${args.dayRange}"`);
  }

  return `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${encodeURIComponent(args.mapKey)}/${encodeURIComponent(source)}/${bbox}/${dayRange}`;
};

/* ---------- CSV ---------- */

/**
 * Parse by header NAME, never by column index: VIIRS and MODIS return the
 * same fields in a different order (bright_ti4 vs brightness), and FIRMS has
 * added columns before. Six fields do not justify a CSV dependency.
 */
export const parseCsv = (text: string): Array<Record<string, string>> => {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  const headerLine = lines[0];
  if (!headerLine) return [];
  const headers = headerLine.split(",").map((h) => h.trim());
  const rows: Array<Record<string, string>> = [];
  for (const line of lines.slice(1)) {
    const cells = line.split(",");
    // A short row is a truncated download, not a row we should guess at.
    if (cells.length < headers.length) continue;
    const row: Record<string, string> = {};
    headers.forEach((h, i) => {
      row[h] = (cells[i] ?? "").trim();
    });
    rows.push(row);
  }
  return rows;
};

/** FIRMS returns an error/quota message as plain text, not CSV. Detect it. */
export const looksLikeCsv = (text: string): boolean =>
  /(^|\n)[^\n]*\blatitude\b[^\n]*,[^\n]*\blongitude\b/i.test(text.slice(0, 2000));

/* ---------- detections ---------- */

/**
 * Stable across runs, which is what makes re-ingest idempotent: the same
 * detection from the same overpass always produces the same id. Coordinates
 * are fixed to 5dp (~1 m) so float formatting can never shift the id.
 */
export const detectionIdOf = (args: {
  satellite: string;
  lat: number;
  lon: number;
  acqDate: string;
  acqTime: string;
}): string =>
  [
    "det",
    args.satellite.toLowerCase().replace(/[^a-z0-9]/g, ""),
    args.lat.toFixed(5),
    args.lon.toFixed(5),
    args.acqDate.replace(/-/g, ""),
    args.acqTime.padStart(4, "0"),
  ].join("_");

/** FIRMS gives acq_date "2026-09-10" and acq_time "607" or "0607", both UTC. */
export const toIsoUtc = (acqDate: string, acqTime: string): string | null => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(acqDate)) return null;
  const t = acqTime.padStart(4, "0");
  if (!/^\d{4}$/.test(t)) return null;
  const iso = `${acqDate}T${t.slice(0, 2)}:${t.slice(2)}:00.000Z`;
  return Number.isNaN(Date.parse(iso)) ? null : iso;
};

/**
 * VIIRS reports confidence as l/n/h, MODIS as 0-100. We drop "low" on
 * purpose: a lot that becomes a carbon credit should not start life at a
 * detection the satellite itself was unsure about.
 */
export const isLowConfidence = (confidence: string): boolean => {
  const c = confidence.trim().toLowerCase();
  // Only refuse what is positively marked low. A blank field is a feed we do
  // not understand, not a detection we know to be weak - and Number("") is 0,
  // which would otherwise silently reject every row.
  if (c === "") return false;
  if (c === "l" || c === "low") return true;
  const n = Number(c);
  return Number.isFinite(n) && n < 30;
};

const num = (v: string | undefined): number | null => {
  if (v === undefined || v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** One CSV row -> one BurnDetection, or null if the row is unusable. */
export const toDetection = (row: Record<string, string>): BurnDetection | null => {
  const lat = num(row["latitude"]);
  const lon = num(row["longitude"]);
  const acqDate = row["acq_date"] ?? "";
  const acqTime = row["acq_time"] ?? "";
  const satellite = row["satellite"]?.trim() || row["instrument"]?.trim() || "unknown";
  if (lat === null || lon === null) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  const acquiredAt = toIsoUtc(acqDate, acqTime);
  if (acquiredAt === null) return null;

  const at: GeoPoint = { lat, lon };
  return {
    detectionId: detectionIdOf({ satellite, lat, lon, acqDate, acqTime }),
    at,
    acquiredAt,
    satellite,
    confidence: row["confidence"]?.trim() ?? "",
    frp: num(row["frp"]),
    district: districtFor(at),
  };
};

/* ---------- districts ---------- */

/**
 * Centroids for the residue belt inside the default bbox. A nearest-centroid
 * lookup, not a polygon test - we have no shapefile and we are labelling a
 * lot for an operator, not settling a boundary dispute. Beyond
 * DISTRICT_MAX_KM we say null rather than guess.
 */
const DISTRICTS: Array<{ name: string; state: "PB" | "HR" | "RJ" | "CH"; at: GeoPoint }> = [
  { name: "Amritsar", state: "PB", at: { lat: 31.63, lon: 74.87 } },
  { name: "Tarn Taran", state: "PB", at: { lat: 31.45, lon: 74.93 } },
  { name: "Gurdaspur", state: "PB", at: { lat: 32.04, lon: 75.4 } },
  { name: "Pathankot", state: "PB", at: { lat: 32.27, lon: 75.65 } },
  { name: "Hoshiarpur", state: "PB", at: { lat: 31.53, lon: 75.91 } },
  { name: "Jalandhar", state: "PB", at: { lat: 31.33, lon: 75.58 } },
  { name: "Kapurthala", state: "PB", at: { lat: 31.38, lon: 75.38 } },
  { name: "Nawanshahr", state: "PB", at: { lat: 31.12, lon: 76.12 } },
  { name: "Ludhiana", state: "PB", at: { lat: 30.9, lon: 75.86 } },
  { name: "Moga", state: "PB", at: { lat: 30.82, lon: 75.17 } },
  { name: "Ferozepur", state: "PB", at: { lat: 30.92, lon: 74.61 } },
  { name: "Fazilka", state: "PB", at: { lat: 30.4, lon: 74.03 } },
  { name: "Faridkot", state: "PB", at: { lat: 30.67, lon: 74.76 } },
  { name: "Muktsar", state: "PB", at: { lat: 30.48, lon: 74.52 } },
  { name: "Bathinda", state: "PB", at: { lat: 30.21, lon: 74.95 } },
  { name: "Mansa", state: "PB", at: { lat: 29.99, lon: 75.39 } },
  { name: "Barnala", state: "PB", at: { lat: 30.38, lon: 75.55 } },
  { name: "Sangrur", state: "PB", at: { lat: 30.25, lon: 75.84 } },
  { name: "Patiala", state: "PB", at: { lat: 30.34, lon: 76.39 } },
  { name: "Fatehgarh Sahib", state: "PB", at: { lat: 30.64, lon: 76.39 } },
  { name: "Rupnagar", state: "PB", at: { lat: 30.97, lon: 76.53 } },
  { name: "SAS Nagar", state: "PB", at: { lat: 30.7, lon: 76.72 } },
  { name: "Chandigarh", state: "CH", at: { lat: 30.73, lon: 76.78 } },
  { name: "Ambala", state: "HR", at: { lat: 30.38, lon: 76.78 } },
  { name: "Yamunanagar", state: "HR", at: { lat: 30.13, lon: 77.29 } },
  { name: "Kurukshetra", state: "HR", at: { lat: 29.97, lon: 76.88 } },
  { name: "Karnal", state: "HR", at: { lat: 29.69, lon: 76.99 } },
  { name: "Kaithal", state: "HR", at: { lat: 29.8, lon: 76.4 } },
  { name: "Jind", state: "HR", at: { lat: 29.32, lon: 76.31 } },
  { name: "Fatehabad", state: "HR", at: { lat: 29.51, lon: 75.45 } },
  { name: "Sirsa", state: "HR", at: { lat: 29.53, lon: 75.03 } },
  { name: "Hisar", state: "HR", at: { lat: 29.15, lon: 75.72 } },
  { name: "Sri Ganganagar", state: "RJ", at: { lat: 29.92, lon: 73.88 } },
];

export const DISTRICT_MAX_KM = 60;

export const districtFor = (at: GeoPoint): string | null => {
  let best: { name: string; km: number } | null = null;
  for (const d of DISTRICTS) {
    const km = haversineKm(at, d.at);
    if (best === null || km < best.km) best = { name: d.name, km };
  }
  return best && best.km <= DISTRICT_MAX_KM ? best.name : null;
};

const stateOf = (district: string | null): "PB" | "HR" | "RJ" | "CH" =>
  DISTRICTS.find((d) => d.name === district)?.state ?? "PB";

/* ---------- feedstock and tonnage ---------- *
 *
 * Punjab and Haryana burn residue in two windows: paddy straw after the
 * kharif harvest (Oct-Nov) and wheat straw after rabi (Apr-May). Outside
 * those we will not claim to know which, so it is "mixed".
 */
export const feedstockForDate = (isoDate: string): FeedstockClass => {
  const month = new Date(isoDate).getUTCMonth() + 1;
  if (month === 10 || month === 11) return "paddy_straw";
  if (month === 4 || month === 5) return "wheat_straw";
  return "mixed";
};

/** Residue actually left on the field, tonnes per hectare. */
const RESIDUE_YIELD_T_PER_HA: Record<FeedstockClass, number> = {
  paddy_straw: 5.5,
  wheat_straw: 3.0,
  sugarcane_trash: 10.0,
  maize_stover: 4.5,
  mixed: 4.0,
};

/** Average operational landholding, hectares (Agriculture Census 2015-16). */
const HOLDING_HA: Record<"PB" | "HR" | "RJ" | "CH", number> = {
  PB: 3.62,
  HR: 2.22,
  RJ: 2.73,
  CH: 2.0,
};

/**
 * How much of the residue on a burning field could realistically be
 * collected instead of burnt. Baling leaves stubble and loses material in
 * handling; 0.8 is the number we defend out loud, and it is the single
 * assumption most worth challenging in this file.
 */
export const COLLECTABLE_FRACTION = 0.8;

/**
 * Wooster et al. (2005, JGR 110 D24311) established that fire radiative
 * energy converts to dry fuel consumed at ~0.368 kg per MJ. FRP is reported
 * in MW, i.e. MJ per second, so over a burn of `FLAMING_SECONDS` seconds:
 *
 *     consumed kg = 0.368 kg/MJ  x  FRP MW  x  seconds
 *
 * A straw field burn is a flaming front that passes in well under an hour;
 * we take 30 minutes. FRP is a single instantaneous sample at the satellite
 * overpass, not the mean over the burn, so this is an estimate with real
 * error bars in both directions - which is exactly why we clamp it.
 */
export const FRE_KG_PER_MJ = 0.368;
export const FLAMING_SECONDS = 1800;
export const MIN_LOT_TONNES = 1.5;
export const MAX_LOT_TONNES = 60;

/** Per-district fallback when FRP is missing: a typical holding's worth. */
export const defaultTonnesFor = (district: string | null, feedstock: FeedstockClass): number =>
  round1(HOLDING_HA[stateOf(district)] * RESIDUE_YIELD_T_PER_HA[feedstock] * COLLECTABLE_FRACTION);

export const estimateTonnes = (args: {
  frp: number | null;
  district: string | null;
  feedstock: FeedstockClass;
}): number => {
  const fallback = defaultTonnesFor(args.district, args.feedstock);
  const tonnes =
    args.frp !== null && args.frp > 0
      ? (FRE_KG_PER_MJ * args.frp * FLAMING_SECONDS) / 1000
      : fallback;
  return round1(Math.min(MAX_LOT_TONNES, Math.max(MIN_LOT_TONNES, tonnes)));
};

const round1 = (n: number) => Math.round(n * 10) / 10;

/* ---------- detections -> lots ---------- */

/** A lot id derived from its detection, so re-ingest cannot fork a new lot. */
export const lotIdOf = (detectionId: string): string => detectionId.replace(/^det_/, "lot_");

const producerIdOf = (district: string | null): string =>
  `prod_${(district ?? "unknown").toLowerCase().replace(/[^a-z0-9]+/g, "_")}`;

export const toLot = (d: BurnDetection): ResidueLot => {
  const feedstock = feedstockForDate(d.acquiredAt);
  return {
    lotId: lotIdOf(d.detectionId),
    producerId: producerIdOf(d.district),
    at: d.at,
    district: d.district,
    feedstock,
    tonnes: estimateTonnes({ frp: d.frp, district: d.district, feedstock }),
    availableFrom: d.acquiredAt,
    sourceDetectionId: d.detectionId,
    status: "listed",
  };
};

export type IngestPlan = {
  /** Rows that parsed into a usable detection. */
  parsed: number;
  /** Detections we have never seen before. */
  detections: BurnDetection[];
  /** One lot per new detection. */
  lots: ResidueLot[];
  skippedLowConfidence: number;
  skippedDuplicate: number;
  skippedUnparseable: number;
};

/**
 * The whole ingest decision in one pure function: which rows become lots,
 * and which are dropped and why. `knownDetectionIds` is what the database
 * already holds, so running this twice with the results of the first run
 * yields nothing the second time. That is the dedupe guarantee.
 */
export const planIngest = (
  rows: Array<Record<string, string>>,
  knownDetectionIds: ReadonlySet<string>,
): IngestPlan => {
  const plan: IngestPlan = {
    parsed: 0,
    detections: [],
    lots: [],
    skippedLowConfidence: 0,
    skippedDuplicate: 0,
    skippedUnparseable: 0,
  };
  // Within one response FIRMS can repeat a detection across overlapping
  // granules, so dedupe against this batch as well as against the database.
  const seen = new Set(knownDetectionIds);
  for (const row of rows) {
    const detection = toDetection(row);
    if (detection === null) {
      plan.skippedUnparseable += 1;
      continue;
    }
    plan.parsed += 1;
    if (isLowConfidence(String(detection.confidence))) {
      plan.skippedLowConfidence += 1;
      continue;
    }
    if (seen.has(detection.detectionId)) {
      plan.skippedDuplicate += 1;
      continue;
    }
    seen.add(detection.detectionId);
    plan.detections.push(detection);
    plan.lots.push(toLot(detection));
  }
  return plan;
};
