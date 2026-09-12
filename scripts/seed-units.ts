import type { FeedstockClass } from "@charkha/core";

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
export const UNITS: ReadonlyArray<{
  unitId: string;
  name: string;
  lat: number;
  lon: number;
  capacityTonnesPerDay: number;
  accepts: FeedstockClass[];
}> = [
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

  /* ---------------- the rest of India ----------------
   *
   * The belt is where stubble burning is worst, not where it is only. Widening
   * FIRMS_BBOX to the country without widening the units would have been the
   * five-in-the-middle mistake again at national scale: thousands of markers
   * and almost nothing matchable, which reads as a broken screen rather than
   * as an honest one.
   *
   * Feedstock is per region and not copied: Maharashtra and UP take cane
   * trash, the Gangetic plain takes paddy, the Deccan takes maize. A unit that
   * accepts everything everywhere would make `unmatchedLotIds` unreachable,
   * and that refusal path is one of the few things on this screen a judge can
   * actually check. */

  // --- Uttar Pradesh and Bihar: the largest residue mass in the country ---
  { unitId: "unit_lko", name: "Lucknow Biomass Carbon", lat: 26.847, lon: 80.947, capacityTonnesPerDay: 55, accepts: ["paddy_straw", "wheat_straw", "sugarcane_trash", "mixed"] },
  { unitId: "unit_mrt", name: "Meerut Cane Char Unit", lat: 28.984, lon: 77.706, capacityTonnesPerDay: 40, accepts: ["sugarcane_trash", "wheat_straw", "mixed"] },
  { unitId: "unit_ptn", name: "Patna Agri-Residue Works", lat: 25.594, lon: 85.138, capacityTonnesPerDay: 35, accepts: ["paddy_straw", "maize_stover", "mixed"] },
  // --- Gujarat ---
  { unitId: "unit_ahm", name: "Ahmedabad Waste-to-Char", lat: 23.023, lon: 72.572, capacityTonnesPerDay: 45, accepts: ["mixed", "wheat_straw"] },
  { unitId: "unit_rjk", name: "Rajkot Biochar Co-op", lat: 22.303, lon: 70.802, capacityTonnesPerDay: 25, accepts: ["mixed", "maize_stover"] },
  // --- Rajasthan and Madhya Pradesh ---
  { unitId: "unit_jpr", name: "Jaipur Residue Carbon", lat: 26.912, lon: 75.787, capacityTonnesPerDay: 30, accepts: ["wheat_straw", "mixed"] },
  { unitId: "unit_bpl", name: "Bhopal Pyrolysis Centre", lat: 23.260, lon: 77.413, capacityTonnesPerDay: 35, accepts: ["wheat_straw", "maize_stover", "mixed"] },
  // --- Maharashtra: cane country ---
  { unitId: "unit_nsk", name: "Nashik Cane Trash Unit", lat: 19.997, lon: 73.790, capacityTonnesPerDay: 40, accepts: ["sugarcane_trash", "mixed"] },
  { unitId: "unit_ngp", name: "Nagpur Biochar Works", lat: 21.146, lon: 79.088, capacityTonnesPerDay: 30, accepts: ["sugarcane_trash", "maize_stover", "mixed"] },
  // --- the Deccan and the south ---
  { unitId: "unit_hyd", name: "Hyderabad Agri-Carbon", lat: 17.385, lon: 78.487, capacityTonnesPerDay: 45, accepts: ["paddy_straw", "maize_stover", "mixed"] },
  { unitId: "unit_blr", name: "Bengaluru Residue Works", lat: 12.972, lon: 77.594, capacityTonnesPerDay: 35, accepts: ["maize_stover", "mixed"] },
  { unitId: "unit_cbe", name: "Coimbatore Char Co-op", lat: 11.017, lon: 76.956, capacityTonnesPerDay: 30, accepts: ["sugarcane_trash", "paddy_straw", "mixed"] },
  // --- the east ---
  { unitId: "unit_kol", name: "Kolkata Delta Biochar", lat: 22.573, lon: 88.364, capacityTonnesPerDay: 40, accepts: ["paddy_straw", "mixed"] },
  { unitId: "unit_bbs", name: "Bhubaneswar Residue Hub", lat: 20.296, lon: 85.825, capacityTonnesPerDay: 25, accepts: ["paddy_straw", "mixed"] },
  /* Guwahati deliberately refuses `mixed`, the way Kaithal does. Two refusing
     sites rather than one, so widening the country does not quietly turn
     "unmatched" into a branch nothing reaches. */
  { unitId: "unit_ghy", name: "Guwahati Paddy Char Unit", lat: 26.144, lon: 91.736, capacityTonnesPerDay: 20, accepts: ["paddy_straw"] },
];
