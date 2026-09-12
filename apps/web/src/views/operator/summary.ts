import type { Match, ResidueLot } from "@charkha/core";

/* ------------------------------------------------------------------ *
 * OWNER: Harsh
 *
 * The numbers and the words the Operator view shows. Pure, so they can be
 * tested without a DOM - same shape as the Field view's evidence.ts.
 *
 * These are here rather than inline in the component because both have been
 * wrong before: the strip once read "43 lots / 14.1 t" because the count and
 * the tonnes disagreed about which lots they meant, and it took looking at
 * the deployed host to notice.
 * ------------------------------------------------------------------ */

/**
 * Match radius options, in km.
 *
 * Not free text. Three named operating choices rather than a slider, because
 * the number has to be defensible out loud:
 *
 *   60  - a real biomass catchment. Straw is bulky and low value, so 50-100 km
 *         is where actual plants draw from. This is the contract default.
 *   75  - a stretch haul: worth asking "what if we could go further?"
 *  115  - show me everything reachable, whatever the haul costs.
 *
 * Deliberately NOT derived from today's detections. They happen to line up
 * with the current feed's thresholds, but a value fitted to one day's data is
 * wrong the next morning and nobody would notice.
 */
export const RADIUS_OPTIONS = [60, 75, 115] as const;

/** Must equal RunMatchingInput's default - asserted in the test. */
export const DEFAULT_RADIUS_KM = 60;

export type Totals = {
  /** Lots still available to match. */
  listed: number;
  /** Every lot drawn on the map, matched ones included. */
  onMap: number;
  tonnes: number;
  matched: number;
  debit: number;
};

/**
 * `listed` and `tonnes` must describe the SAME set, or the strip contradicts
 * itself: 43 lots beside 14.1 t reads as a third of a tonne per lot, and a
 * judge who does that division stops trusting every other number on screen.
 */
export const summarise = (lots: readonly ResidueLot[], matches: readonly Match[]): Totals => {
  const listed = lots.filter((l) => l.status === "listed");
  return {
    listed: listed.length,
    onMap: lots.length,
    tonnes: listed.reduce((sum, l) => sum + l.tonnes, 0),
    matched: matches.length,
    debit: matches.reduce((sum, m) => sum + m.transportKgCo2e, 0),
  };
};

/**
 * What the panel says when a round left lots on the table.
 *
 * Takes the radius rather than reading a constant, so the sentence on screen
 * and the `maxRadiusKm` in the request are the same value by construction.
 * The matchmaker's own per-lot reason also quotes the radius it was given, so
 * if these two could drift the screen would be contradicting the ledger.
 */
export const unplacedMessage = (count: number, radiusKm: number): string =>
  `${count} lot${count === 1 ? "" : "s"} could not be placed within ${radiusKm} km of a unit with capacity.`;
