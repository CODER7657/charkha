/* ------------------------------------------------------------------ *
 * Carbon factors.
 *
 * Every number here MUST carry a `source` string naming where it came
 * from. A judge will ask "where did 2.4 come from" and "we guessed" is a
 * losing answer. If you change a value, change its source with it.
 * The shape follows Puro.earth CORCCHAR's three evidence classes:
 * production evidence, application evidence, chain of custody.
 * ------------------------------------------------------------------ */

export type Factor = { value: number; unit: string; source: string };

export const FACTORS = {
  /**
   * tCO2e permanently sequestered per tonne of biochar applied to soil.
   *
   *   FCorg 0.49 tC/t biochar  x  Fperm 0.80  x  44/12  =  1.437 tCO2e/t
   *
   * FCorg and Fperm are the IPCC Tier-1 defaults for rice husk/straw
   * feedstock and medium-temperature pyrolysis (450-600 C).
   */
  biocharSequestrationPerTonne: {
    value: 1.437,
    unit: "tCO2e / t biochar",
    source:
      "IPCC 2019 Refinement to the 2006 Guidelines, Vol.4 Ch.2 Appendix 4, Table 4Ap.1 (FCorg = 0.49 tC/t biochar, rice husks and rice straw, pyrolysis) and Table 4Ap.2 (Fperm = 0.80, medium-temperature pyrolysis 450-600 C), converted by 44/12. Rice-straw class chosen deliberately over the herbaceous class (FCorg 0.65, which would give 1.91) because paddy straw is our primary feedstock and under-crediting the rest is the conservative error.",
  },
  /** Mass yield of biochar from dry feedstock via slow pyrolysis. */
  biocharYieldFromFeedstock: {
    value: 0.28,
    unit: "t biochar / t dry feedstock",
    source:
      "Slow pyrolysis of rice straw at 450-550 C reports biochar yields of roughly 25-35 wt% of dry feedstock; we take 0.28, the low-middle of that range. Park, Lee, Ryu & Park (2014), 'Slow pyrolysis of rice straw: analysis of products properties, carbon and energy yields', Bioresource Technology 155:63-70. Consistent with the biochar-yield regression of Woolf et al. (2014) that IPCC 2019 Refinement Vol.4 Ch.2 App.4 uses to derive FCorg.",
  },
  /**
   * Road freight emission factor, India-specific, well-to-wheel.
   * Baled residue is volume-limited on short rural hauls, so we use the
   * medium-truck factor rather than the lower long-haul HCV one.
   */
  roadFreight: {
    value: 0.14,
    unit: "kgCO2e / tonne-km",
    source:
      "Smart Freight Centre, 'India Default GHG Emission Values v1.0' (complementing GLEC Framework v3.0), road emission intensity table: Medium Commercial Vehicle-2 (GVW 5-12 t, payload 3.5-8 t), diesel, WTW = 0.1400 kgCO2e/tonne-km. India-specific. We do NOT use the lighter 12-20 t HCV figure (0.0902) because baled crop residue fills the truck by volume long before payload, so the per-tonne figure for a smaller truck is the honest one.",
  },
  /**
   * Process energy debited per tonne of biochar produced. Pyrolysis heat is
   * self-supplied by the syngas, so this covers auxiliary grid electricity
   * only (chipping, feeding, off-gas handling).
   */
  pyrolysisProcessDebit: {
    value: 0.045,
    unit: "tCO2e / t biochar",
    source:
      "Assumed 55 kWh auxiliary grid electricity per tonne of biochar x 0.82 kgCO2/kWh = 0.045 tCO2e/t. Grid factor: Central Electricity Authority, 'CO2 Baseline Database for the Indian Power Sector' v19 (2022-23), the same factor Smart Freight Centre uses for India. No fuel debit for process heat: slow pyrolysis is energy self-sufficient on its own syngas (Roberts, Gloy, Joseph, Scott & Lehmann (2010), Environ. Sci. Technol. 44(2):827-833). The 55 kWh/t is our stated plant assumption, not a measured figure - it is the one number here we would replace with metered data from a real unit.",
  },
} as const satisfies Record<string, Factor>;

/** Transport debit for moving `tonnes` over `km`, in kgCO2e. */
export const transportKgCo2e = (tonnes: number, km: number): number =>
  tonnes * km * FACTORS.roadFreight.value;

export type CreditMath = {
  grossSequestrationTco2e: number;
  transportDebitTco2e: number;
  processDebitTco2e: number;
  netTonnesCo2e: number;
};

/**
 * Net credit for one converted lot. Deliberately simple and fully
 * auditable - every term traces to a FACTORS entry.
 */
export const computeCredit = (args: {
  feedstockTonnes: number;
  biocharTonnes?: number;
  transportKm: number;
  qualityScore: number;
}): CreditMath => {
  const biochar = args.biocharTonnes ?? args.feedstockTonnes * FACTORS.biocharYieldFromFeedstock.value;
  const quality = Math.max(0, Math.min(1, args.qualityScore));
  const gross = biochar * FACTORS.biocharSequestrationPerTonne.value * quality;
  const transport = transportKgCo2e(args.feedstockTonnes, args.transportKm) / 1000;
  const process = biochar * FACTORS.pyrolysisProcessDebit.value;
  return {
    grossSequestrationTco2e: round3(gross),
    transportDebitTco2e: round3(transport),
    processDebitTco2e: round3(process),
    netTonnesCo2e: round3(gross - transport - process),
  };
};

const round3 = (n: number) => Math.round(n * 1000) / 1000;
