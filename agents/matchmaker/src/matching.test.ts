import { describe, it, expect } from "vitest";
import type { ConversionUnit, FeedstockClass, ResidueLot } from "@charkha/core";
import { assign } from "./matching.ts";

/* Real coordinates from the seeded units, so the distances in these tests
   are the distances the demo actually shows. */
const LUDHIANA = { lat: 30.901, lon: 75.857 };
const PATIALA = { lat: 30.339, lon: 76.386 };
const KARNAL = { lat: 29.686, lon: 76.989 };
const CHENNAI = { lat: 13.083, lon: 80.27 };

const unit = (over: Partial<ConversionUnit> = {}): ConversionUnit => ({
  unitId: "unit_ldh",
  name: "Ludhiana Biochar Works",
  at: LUDHIANA,
  capacityTonnesPerDay: 45,
  accepts: ["paddy_straw", "wheat_straw", "mixed"],
  ...over,
});

const lot = (over: Partial<ResidueLot> = {}): ResidueLot => ({
  lotId: "lot_a",
  producerId: "prod_ludhiana",
  at: LUDHIANA,
  district: "Ludhiana",
  feedstock: "paddy_straw" as FeedstockClass,
  tonnes: 10,
  availableFrom: "2026-10-22T08:12:00.000Z",
  sourceDetectionId: "det_a",
  status: "listed",
  ...over,
});

describe("the happy path", () => {
  it("places every lot that fits and explains each one", () => {
    const result = assign({
      lots: [lot({ lotId: "lot_a", tonnes: 12 }), lot({ lotId: "lot_b", tonnes: 8, at: PATIALA })],
      units: [unit(), unit({ unitId: "unit_pta", name: "Patiala Pyrolysis Co-op", at: PATIALA, capacityTonnesPerDay: 30 })],
      maxRadiusKm: 60,
    });

    expect(result.assignments).toHaveLength(2);
    expect(result.unmatched).toHaveLength(0);
    // A lot sitting on top of a unit goes to that unit.
    expect(result.assignments.find((a) => a.lotId === "lot_a")?.unitId).toBe("unit_ldh");
    expect(result.assignments.find((a) => a.lotId === "lot_b")?.unitId).toBe("unit_pta");
    for (const a of result.assignments) {
      expect(a.rationale).toMatch(/km/);
      expect(a.rationale).toMatch(/capacity free/);
      expect(a.assignedTonnes).toBeGreaterThan(0);
    }
  });

  it("prefers the unit with the smaller transport debit", () => {
    const result = assign({
      lots: [lot({ at: PATIALA })],
      units: [
        unit({ unitId: "unit_far", at: LUDHIANA }),
        unit({ unitId: "unit_near", at: PATIALA }),
      ],
      maxRadiusKm: 200,
    });

    expect(result.assignments[0]?.unitId).toBe("unit_near");
    expect(result.assignments[0]?.rationale).toContain("nearest accepting unit");
  });

  it("places the biggest lot first, because it is the hardest to place", () => {
    // 30 t of capacity, a 25 t lot and a 20 t lot. Only one can go.
    const result = assign({
      lots: [lot({ lotId: "lot_small", tonnes: 20 }), lot({ lotId: "lot_big", tonnes: 25 })],
      units: [unit({ capacityTonnesPerDay: 30 })],
      maxRadiusKm: 60,
    });

    expect(result.assignments.map((a) => a.lotId)).toEqual(["lot_big"]);
    expect(result.unmatched.map((u) => u.lotId)).toEqual(["lot_small"]);
  });

  it("is reproducible: the same round twice gives the same answer", () => {
    const args = {
      lots: [lot({ lotId: "lot_a" }), lot({ lotId: "lot_b", at: PATIALA }), lot({ lotId: "lot_c", at: KARNAL })],
      units: [unit(), unit({ unitId: "unit_pta", at: PATIALA }), unit({ unitId: "unit_krl", at: KARNAL })],
      maxRadiusKm: 60,
    };
    expect(assign(args)).toEqual(assign(args));
  });

  it("leaves the caller's arrays alone", () => {
    const lots = [lot({ lotId: "lot_a", tonnes: 5 }), lot({ lotId: "lot_b", tonnes: 40 })];
    const order = lots.map((l) => l.lotId);

    assign({ lots, units: [unit()], maxRadiusKm: 60 });

    expect(lots.map((l) => l.lotId)).toEqual(order);
  });
});

describe("what must be refused", () => {
  /* THE UNDER-CAPACITY ROUND — required by the definition of done. */
  it("returns the lots it could not place when capacity runs out", () => {
    const result = assign({
      lots: [
        lot({ lotId: "lot_a", tonnes: 20 }),
        lot({ lotId: "lot_b", tonnes: 20 }),
        lot({ lotId: "lot_c", tonnes: 20 }),
      ],
      units: [unit({ capacityTonnesPerDay: 45 })],
      maxRadiusKm: 60,
    });

    expect(result.assignments).toHaveLength(2);
    expect(result.unmatched).toHaveLength(1);
    expect(result.unmatched[0]?.lotId).toBe("lot_c");
    expect(result.unmatched[0]?.reason).toContain("capacity");
    // 45 t of capacity, 40 t assigned: the round does not overcommit the unit.
    expect(result.remainingCapacity["unit_ldh"]).toBe(5);
  });

  it("refuses a lot outside the radius and says how far away the unit was", () => {
    const result = assign({
      lots: [lot({ at: CHENNAI })],
      units: [unit()],
      maxRadiusKm: 60,
    });

    expect(result.assignments).toHaveLength(0);
    expect(result.unmatched[0]?.reason).toMatch(/outside the 60 km radius/);
  });

  it("refuses a lot no unit will take", () => {
    const result = assign({
      lots: [lot({ feedstock: "sugarcane_trash" })],
      units: [unit({ accepts: ["paddy_straw", "wheat_straw"] })],
      maxRadiusKm: 60,
    });

    expect(result.assignments).toHaveLength(0);
    expect(result.unmatched[0]?.reason).toBe("no unit accepts sugarcane_trash");
  });

  it("does not split a lot across two units to make it fit", () => {
    // 30 t lot, two units with 20 t each: plenty of capacity in total, but
    // none of it in one place. The lot stays unmatched on purpose.
    const result = assign({
      lots: [lot({ tonnes: 30 })],
      units: [
        unit({ unitId: "unit_a", capacityTonnesPerDay: 20 }),
        unit({ unitId: "unit_b", capacityTonnesPerDay: 20, at: PATIALA }),
      ],
      maxRadiusKm: 200,
    });

    expect(result.assignments).toHaveLength(0);
    expect(result.unmatched).toHaveLength(1);
  });

  it("handles a round with nothing to do", () => {
    expect(assign({ lots: [], units: [unit()], maxRadiusKm: 60 }).assignments).toHaveLength(0);
  });
});

describe("distance and transport debit", () => {
  /* THE KNOWN-PAIR ASSERTION — required by the definition of done.
     Ludhiana (30.901, 75.857) -> Patiala (30.339, 76.386):
       great-circle    ~80.5 km
       road (x1.30)    ~104.6 km
       10 t at 0.107 kgCO2e/t-km  ~111.9 kgCO2e                       */
  it("matches a hand-computed distance and debit for a known pair of points", () => {
    const result = assign({
      lots: [lot({ at: PATIALA, tonnes: 10 })],
      units: [unit({ at: LUDHIANA })],
      maxRadiusKm: 200,
    });

    const match = result.assignments[0];
    expect(match?.distanceKm).toBeCloseTo(104.6, 0);
    expect(match?.transportKgCo2e).toBeCloseTo(111.9, 0);
  });

  it("charges more for a heavier load over the same road", () => {
    const light = assign({ lots: [lot({ at: PATIALA, tonnes: 5 })], units: [unit()], maxRadiusKm: 200 });
    const heavy = assign({ lots: [lot({ at: PATIALA, tonnes: 20 })], units: [unit()], maxRadiusKm: 200 });

    expect(heavy.assignments[0]?.transportKgCo2e).toBeGreaterThan(
      light.assignments[0]?.transportKgCo2e ?? 0,
    );
    expect(heavy.assignments[0]?.distanceKm).toBe(light.assignments[0]?.distanceKm);
  });

  it("never reports a negative debit", () => {
    const result = assign({ lots: [lot()], units: [unit()], maxRadiusKm: 60 });
    expect(result.assignments[0]?.transportKgCo2e).toBeGreaterThanOrEqual(0);
    expect(result.assignments[0]?.distanceKm).toBeGreaterThanOrEqual(0);
  });
});
