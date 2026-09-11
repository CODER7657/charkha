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
  /** tCO2e permanently sequestered per tonne of biochar applied to soil. */
  biocharSequestrationPerTonne: {
    value: 2.4,
    unit: "tCO2e / t biochar",
    source: "PLACEHOLDER - Ayush: replace with the CORCCHAR-derived figure and cite it here",
  },
  /** Mass yield of biochar from dry feedstock via slow pyrolysis. */
  biocharYieldFromFeedstock: {
    value: 0.28,
    unit: "t biochar / t dry feedstock",
    source: "PLACEHOLDER - Ayush: cite a published slow-pyrolysis yield range",
  },
  /** Road freight emission factor, diesel HGV. */
  roadFreight: {
    value: 0.107,
    unit: "kgCO2e / tonne-km",
    source: "PLACEHOLDER - Ayush: cite DEFRA or India-specific factor",
  },
  /** Process energy debited per tonne of biochar produced. */
  pyrolysisProcessDebit: {
    value: 0.05,
    unit: "tCO2e / t biochar",
    source: "PLACEHOLDER - Ayush: cite or justify",
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
