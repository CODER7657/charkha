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
 */
const UNITS = [
  { unitId: "unit_ldh", name: "Ludhiana Biochar Works", lat: 30.901, lon: 75.857, capacityTonnesPerDay: 45, accepts: ["paddy_straw", "wheat_straw", "mixed"] },
  { unitId: "unit_pta", name: "Patiala Pyrolysis Co-op", lat: 30.339, lon: 76.386, capacityTonnesPerDay: 30, accepts: ["paddy_straw", "mixed"] },
  { unitId: "unit_krl", name: "Karnal Agri-Carbon", lat: 29.686, lon: 76.989, capacityTonnesPerDay: 60, accepts: ["paddy_straw", "wheat_straw", "maize_stover"] },
  { unitId: "unit_bnl", name: "Barnala Briquette Unit", lat: 30.381, lon: 75.546, capacityTonnesPerDay: 20, accepts: ["wheat_straw", "mixed"] },
  { unitId: "unit_ktl", name: "Kaithal Residue Processing", lat: 29.801, lon: 76.399, capacityTonnesPerDay: 35, accepts: ["paddy_straw", "sugarcane_trash"] },
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
