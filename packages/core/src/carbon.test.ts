import { describe, it, expect } from "vitest";
import { FACTORS, computeCredit } from "./carbon.ts";

/* "Where did that number come from" is the question this file answers. */

describe("carbon factors", () => {
  it("every factor cites a source", () => {
    for (const [name, factor] of Object.entries(FACTORS)) {
      expect(factor.source, `${name} has no source`).toBeTruthy();
      expect(factor.source.length, `${name}'s source is too thin to be a citation`).toBeGreaterThan(40);
      expect(factor.source, `${name} is still a placeholder`).not.toMatch(/placeholder|TODO|TBD/i);
    }
  });

  it("derives sequestration from the IPCC Tier-1 defaults it cites", () => {
    // FCorg 0.49 tC/t biochar (rice straw, pyrolysis) x Fperm 0.80 x 44/12
    expect(FACTORS.biocharSequestrationPerTonne.value).toBeCloseTo(0.49 * 0.8 * (44 / 12), 3);
  });

  it("keeps every factor physically plausible", () => {
    expect(FACTORS.biocharYieldFromFeedstock.value).toBeGreaterThan(0);
    expect(FACTORS.biocharYieldFromFeedstock.value).toBeLessThan(1);
    // A tonne of biochar cannot lock more CO2 than its carbon could possibly hold.
    expect(FACTORS.biocharSequestrationPerTonne.value).toBeLessThan(44 / 12);
    expect(FACTORS.pyrolysisProcessDebit.value).toBeLessThan(FACTORS.biocharSequestrationPerTonne.value);
  });
});

describe("computeCredit", () => {
  it("nets out to gross minus both debits", () => {
    const m = computeCredit({ feedstockTonnes: 12, biocharTonnes: 3.2, transportKm: 42.5, qualityScore: 0.88 });
    // Each term is rounded to 3dp independently, so the reported net can sit
    // up to one rounding step away from the sum of the reported parts.
    expect(m.netTonnesCo2e).toBeCloseTo(
      m.grossSequestrationTco2e - m.transportDebitTco2e - m.processDebitTco2e,
      2,
    );
  });

  it("falls back to the yield factor when biochar mass was not measured", () => {
    const measured = computeCredit({ feedstockTonnes: 10, biocharTonnes: 2.8, transportKm: 0, qualityScore: 1 });
    const assumed = computeCredit({ feedstockTonnes: 10, transportKm: 0, qualityScore: 1 });
    expect(assumed.grossSequestrationTco2e).toBeCloseTo(measured.grossSequestrationTco2e, 3);
  });

  it("clamps a quality score outside 0..1 rather than inventing carbon", () => {
    const over = computeCredit({ feedstockTonnes: 10, transportKm: 10, qualityScore: 5 });
    const perfect = computeCredit({ feedstockTonnes: 10, transportKm: 10, qualityScore: 1 });
    expect(over.netTonnesCo2e).toBe(perfect.netTonnesCo2e);
  });

  it("can go negative when the haul is long enough to eat the credit", () => {
    const absurd = computeCredit({ feedstockTonnes: 10, transportKm: 5000, qualityScore: 1 });
    expect(absurd.netTonnesCo2e).toBeLessThan(0);
  });
});
