import { describe, expect, it } from "vitest";
import { DEFAULT_BBOX } from "../agents/producer/src/firms.ts";
import { UNITS } from "./seed-units.ts";

/* ------------------------------------------------------------------ *
 * The bbox and the units have to move together.
 *
 * Widening FIRMS_BBOX is one string. Placing units to match it is twenty
 * lines of data, and nothing forces the second to follow the first - so the
 * failure mode is a country full of detections with every unit in Punjab,
 * which renders as a busy map where "Run matching" does nothing. That is the
 * five-units-in-the-middle bug from #33 at national scale, and it looks like
 * a broken screen rather than an honest one.
 *
 * These tests fail when the box grows and the units do not.
 * ------------------------------------------------------------------ */

const [west, south, east, north] = DEFAULT_BBOX.split(",").map(Number) as [number, number, number, number];

describe("seeded units against the bbox the producer actually pulls", () => {
  it("puts every unit inside the box", () => {
    for (const u of UNITS) {
      expect(u.lon, u.name).toBeGreaterThanOrEqual(west);
      expect(u.lon, u.name).toBeLessThanOrEqual(east);
      expect(u.lat, u.name).toBeGreaterThanOrEqual(south);
      expect(u.lat, u.name).toBeLessThanOrEqual(north);
    }
  });

  /* Span, not count. Thirty units clustered in one state would pass a count
     check and still leave most of the box unserved. */
  it("spreads them across most of the box, north to south", () => {
    const lats = UNITS.map((u) => u.lat);
    const covered = Math.max(...lats) - Math.min(...lats);
    expect(covered / (north - south)).toBeGreaterThan(0.6);
  });

  it("spreads them across most of the box, east to west", () => {
    const lons = UNITS.map((u) => u.lon);
    const covered = Math.max(...lons) - Math.min(...lons);
    expect(covered / (east - west)).toBeGreaterThan(0.6);
  });

  /* No lot may be placed at a unit that refuses its feedstock, and that
     refusal is one of the few things on this screen a judge can check. If
     every unit accepted everything, `unmatchedLotIds` would be unreachable
     and the branch would rot. */
  it("keeps at least one unit that refuses mixed loads", () => {
    expect(UNITS.some((u) => !u.accepts.includes("mixed"))).toBe(true);
  });

  it("gives every unit a distinct id", () => {
    expect(new Set(UNITS.map((u) => u.unitId)).size).toBe(UNITS.length);
  });
});
