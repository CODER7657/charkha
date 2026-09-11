import { loadEnv } from "@charkha/a2a";
import { db, schema } from "@charkha/db";

// `dotenv/config` resolves .env against cwd, and dotenv is not a dependency
// of the workspace root at all - so `pnpm seed` failed to start on a fresh
// clone. loadEnv finds the .env next to pnpm-workspace.yaml from anywhere.
loadEnv();

/**
 * Seed conversion units so the operator map is never empty on first load.
 * Coordinates are real towns in the Punjab/Haryana residue belt; capacities
 * are illustrative and labelled as such in the UI.
 *
 * WHY TEN AND NOT FIVE. The first five all sat in the centre of the belt, and
 * against live FIRMS detections that produced ZERO matches: median distance
 * from a real detection to the nearest unit of any kind was 153 km, and only
 * 3 of 30 lots were inside the 60 km radius even ignoring feedstock. The belt
 * is roughly 350 km wide; five points in the middle cannot represent it, and
 * "Run matching" quietly did nothing on real data.
 *
 * The five added here sit on the clusters the live feed actually shows -
 * Amritsar/Tarn Taran, Ferozepur, Fazilka, Bathinda and the Rupnagar foothills.
 * Punjab genuinely has biomass and biochar capacity spread across the belt, so
 * this is also the more honest picture; the unrealistic part was five.
 *
 * Kaithal deliberately still refuses `mixed`. Not every site takes an unsorted
 * load, and keeping one that does not means unmatchedLotIds stays a real code
 * path rather than a branch nothing reaches.
 */
const UNITS = [
  // --- central belt ---
  { unitId: "unit_ldh", name: "Ludhiana Biochar Works", lat: 30.901, lon: 75.857, capacityTonnesPerDay: 45, accepts: ["paddy_straw", "wheat_straw", "mixed"] },
  { unitId: "unit_pta", name: "Patiala Pyrolysis Co-op", lat: 30.339, lon: 76.386, capacityTonnesPerDay: 30, accepts: ["paddy_straw", "mixed"] },
  { unitId: "unit_bnl", name: "Barnala Briquette Unit", lat: 30.381, lon: 75.546, capacityTonnesPerDay: 20, accepts: ["wheat_straw", "mixed"] },
  // --- Haryana ---
  { unitId: "unit_krl", name: "Karnal Agri-Carbon", lat: 29.686, lon: 76.989, capacityTonnesPerDay: 60, accepts: ["paddy_straw", "wheat_straw", "maize_stover", "mixed"] },
  { unitId: "unit_ktl", name: "Kaithal Residue Processing", lat: 29.801, lon: 76.399, capacityTonnesPerDay: 35, accepts: ["paddy_straw", "sugarcane_trash"] },
  // --- western Punjab: the biggest unserved cluster ---
  { unitId: "unit_asr", name: "Amritsar Residue Works", lat: 31.633, lon: 74.872, capacityTonnesPerDay: 40, accepts: ["paddy_straw", "wheat_straw", "mixed"] },
  { unitId: "unit_fzr", name: "Ferozepur Biomass Hub", lat: 30.925, lon: 74.613, capacityTonnesPerDay: 50, accepts: ["paddy_straw", "wheat_straw", "mixed"] },
  { unitId: "unit_fzk", name: "Fazilka Agri-Carbon", lat: 30.403, lon: 74.028, capacityTonnesPerDay: 20, accepts: ["paddy_straw", "mixed"] },
  { unitId: "unit_bti", name: "Bathinda Char Co-op", lat: 30.211, lon: 74.945, capacityTonnesPerDay: 30, accepts: ["paddy_straw", "mixed"] },
  // --- Rupnagar foothills ---
  { unitId: "unit_anp", name: "Anandpur Sahib Pyrolysis", lat: 31.239, lon: 76.502, capacityTonnesPerDay: 25, accepts: ["wheat_straw", "mixed"] },
];
const main = async () => {
  const d = db();
  for (const u of UNITS) {
    await d.insert(schema.conversionUnits).values(u).onConflictDoNothing();
  }
  console.log(`seeded ${UNITS.length} conversion units`);
  process.exit(0);
};

void main();
