import { loadEnv } from "@charkha/a2a";
import { db, schema, eq } from "@charkha/db";
import { UNITS } from "./seed-units.ts";

// `dotenv/config` resolves .env against cwd, and dotenv is not a dependency
// of the workspace root at all - so `pnpm seed` failed to start on a fresh
// clone. loadEnv finds the .env next to pnpm-workspace.yaml from anywhere.
loadEnv();

/**
 * onConflictDoUpdate, not DoNothing.
 *
 * DoNothing meant re-seeding could only ever ADD units - any edit to one that
 * already existed was silently discarded. #33 gave Karnal "mixed", the deploy
 * was re-seeded, and the row on the box kept its old accepts list; a lot 31 km
 * from that unit then went unmatched in a live round because the only unit in
 * range still refused its feedstock. Nothing in the output said so: seed
 * printed the same success line either way.
 *
 * Conversion units are reference data - the file is the source of truth, so a
 * re-seed should make the database match the file.
 */
const main = async () => {
  const d = db();
  let inserted = 0;
  let updated = 0;

  for (const u of UNITS) {
    const before = await d
      .select({ id: schema.conversionUnits.unitId })
      .from(schema.conversionUnits)
      .where(eq(schema.conversionUnits.unitId, u.unitId));

    await d
      .insert(schema.conversionUnits)
      .values(u)
      .onConflictDoUpdate({
        target: schema.conversionUnits.unitId,
        set: {
          name: u.name,
          lat: u.lat,
          lon: u.lon,
          capacityTonnesPerDay: u.capacityTonnesPerDay,
          accepts: u.accepts,
        },
      });

    if (before.length > 0) updated += 1;
    else inserted += 1;
  }

  // Say which, so "seeded 10 units" can never again hide a change that did
  // not actually reach the database.
  console.log(`conversion units: ${inserted} inserted, ${updated} updated (${UNITS.length} total)`);
  process.exit(0);
};

void main();
