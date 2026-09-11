import { describe, it, expect } from "vitest";
import { haversineKm } from "./geo.ts";
import { computeCredit, transportKgCo2e } from "./carbon.ts";
import { canonicalJson, hashPayload } from "./ids.ts";

describe("geo", () => {
  it("computes a known distance (Ludhiana -> Patiala, ~90km)", () => {
    const d = haversineKm({ lat: 30.901, lon: 75.857 }, { lat: 30.339, lon: 76.386 });
    expect(d).toBeGreaterThan(70);
    expect(d).toBeLessThan(100);
  });
  it("is zero for the same point", () => {
    expect(haversineKm({ lat: 30, lon: 76 }, { lat: 30, lon: 76 })).toBe(0);
  });
});

describe("canonical json", () => {
  it("hashes key order independently", () => {
    expect(hashPayload({ a: 1, b: 2 })).toBe(hashPayload({ b: 2, a: 1 }));
  });
  it("does not collapse distinct payloads", () => {
    expect(hashPayload({ a: 1 })).not.toBe(hashPayload({ a: 2 }));
  });
  it("sorts nested keys", () => {
    expect(canonicalJson({ z: { b: 1, a: 2 } })).toBe('{"z":{"a":2,"b":1}}');
  });
});

describe("carbon math", () => {
  it("debits transport against gross sequestration", () => {
    const near = computeCredit({ feedstockTonnes: 10, transportKm: 5, qualityScore: 1 });
    const far = computeCredit({ feedstockTonnes: 10, transportKm: 500, qualityScore: 1 });
    expect(far.netTonnesCo2e).toBeLessThan(near.netTonnesCo2e);
  });
  it("scales gross sequestration with quality score", () => {
    const good = computeCredit({ feedstockTonnes: 10, transportKm: 10, qualityScore: 1 });
    const poor = computeCredit({ feedstockTonnes: 10, transportKm: 10, qualityScore: 0.4 });
    expect(poor.grossSequestrationTco2e).toBeLessThan(good.grossSequestrationTco2e);
  });
  it("transport debit grows with distance and mass", () => {
    expect(transportKgCo2e(10, 100)).toBeGreaterThan(transportKgCo2e(10, 10));
    expect(transportKgCo2e(20, 100)).toBeGreaterThan(transportKgCo2e(10, 100));
  });
});
