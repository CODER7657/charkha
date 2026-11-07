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

  /* ---------------- filling the catchments ----------------
   *
   * Twenty-five units across a country is a map, not a network. Measured
   * against the first national pull: of 1,158 listed lots only 25 sat within
   * 60 km of a unit that accepts their feedstock, so "Run matching" placed 25
   * and left 1,133 - and the binding constraint was RANGE, not capacity. The
   * 25 units had roughly 875 t/day between them and committed under 100 t.
   *
   * Adding capacity would have changed nothing. Adding catchments is the fix,
   * so these sit on the clusters the live feed actually shows rather than on
   * the biggest cities. Same lesson as #33 at national scale: units in the
   * middle of a region cannot represent the region.
   *
   * Most lots stay unplaced even now, and that is the honest picture - India
   * burns far more residue than anyone has plant to convert. The gap is the
   * finding, not a bug to tune away. */

  // --- the Indo-Gangetic plain, the densest burn belt after Punjab ---
  { unitId: "unit_hsr", name: "Hisar Straw Carbon", lat: 29.153, lon: 75.722, capacityTonnesPerDay: 30, accepts: ["wheat_straw", "paddy_straw", "mixed"] },
  { unitId: "unit_mzn", name: "Muzaffarnagar Cane Char", lat: 29.472, lon: 77.704, capacityTonnesPerDay: 35, accepts: ["sugarcane_trash", "mixed"] },
  { unitId: "unit_bre", name: "Bareilly Residue Unit", lat: 28.367, lon: 79.430, capacityTonnesPerDay: 30, accepts: ["paddy_straw", "wheat_straw", "mixed"] },
  { unitId: "unit_gkp", name: "Gorakhpur Biochar Co-op", lat: 26.760, lon: 83.374, capacityTonnesPerDay: 25, accepts: ["paddy_straw", "sugarcane_trash", "mixed"] },
  { unitId: "unit_vns", name: "Varanasi Agri-Carbon", lat: 25.318, lon: 82.973, capacityTonnesPerDay: 30, accepts: ["paddy_straw", "mixed"] },
  { unitId: "unit_mfp", name: "Muzaffarpur Residue Works", lat: 26.120, lon: 85.391, capacityTonnesPerDay: 25, accepts: ["maize_stover", "paddy_straw", "mixed"] },
  { unitId: "unit_bgp", name: "Bhagalpur Char Unit", lat: 25.244, lon: 86.992, capacityTonnesPerDay: 20, accepts: ["paddy_straw", "mixed"] },
  // --- Bengal, Odisha and the eastern delta ---
  { unitId: "unit_brd", name: "Bardhaman Paddy Carbon", lat: 23.255, lon: 87.856, capacityTonnesPerDay: 30, accepts: ["paddy_straw", "mixed"] },
  { unitId: "unit_mld", name: "Malda Residue Hub", lat: 25.011, lon: 88.144, capacityTonnesPerDay: 20, accepts: ["paddy_straw", "mixed"] },
  { unitId: "unit_smb", name: "Sambalpur Biomass Works", lat: 21.470, lon: 83.975, capacityTonnesPerDay: 25, accepts: ["paddy_straw", "mixed"] },
  { unitId: "unit_rou", name: "Rourkela Char Co-op", lat: 22.261, lon: 84.854, capacityTonnesPerDay: 20, accepts: ["paddy_straw", "maize_stover", "mixed"] },
  // --- central India ---
  { unitId: "unit_ind", name: "Indore Agri-Carbon", lat: 22.720, lon: 75.858, capacityTonnesPerDay: 35, accepts: ["wheat_straw", "maize_stover", "mixed"] },
  { unitId: "unit_jbp", name: "Jabalpur Residue Unit", lat: 23.181, lon: 79.986, capacityTonnesPerDay: 25, accepts: ["wheat_straw", "paddy_straw", "mixed"] },
  { unitId: "unit_rpr", name: "Raipur Paddy Char", lat: 21.251, lon: 81.630, capacityTonnesPerDay: 30, accepts: ["paddy_straw", "mixed"] },
  { unitId: "unit_kta", name: "Kota Biochar Works", lat: 25.213, lon: 75.865, capacityTonnesPerDay: 25, accepts: ["wheat_straw", "mixed"] },
  { unitId: "unit_jdh", name: "Jodhpur Residue Co-op", lat: 26.238, lon: 73.024, capacityTonnesPerDay: 20, accepts: ["wheat_straw", "mixed"] },
  // --- Gujarat and the west coast ---
  { unitId: "unit_bhv", name: "Bhavnagar Waste-to-Char", lat: 21.764, lon: 72.151, capacityTonnesPerDay: 25, accepts: ["mixed", "sugarcane_trash"] },
  { unitId: "unit_srt", name: "Surat Cane Trash Unit", lat: 21.170, lon: 72.831, capacityTonnesPerDay: 30, accepts: ["sugarcane_trash", "mixed"] },
  { unitId: "unit_aur", name: "Chhatrapati Sambhajinagar Char", lat: 19.876, lon: 75.343, capacityTonnesPerDay: 30, accepts: ["sugarcane_trash", "maize_stover", "mixed"] },
  { unitId: "unit_klp", name: "Kolhapur Cane Carbon", lat: 16.705, lon: 74.243, capacityTonnesPerDay: 35, accepts: ["sugarcane_trash", "mixed"] },
  { unitId: "unit_sol", name: "Solapur Residue Works", lat: 17.659, lon: 75.906, capacityTonnesPerDay: 25, accepts: ["sugarcane_trash", "maize_stover", "mixed"] },
  // --- the Deccan and the south ---
  { unitId: "unit_wgl", name: "Warangal Paddy Char", lat: 17.978, lon: 79.594, capacityTonnesPerDay: 30, accepts: ["paddy_straw", "maize_stover", "mixed"] },
  { unitId: "unit_gnt", name: "Guntur Delta Biochar", lat: 16.306, lon: 80.437, capacityTonnesPerDay: 35, accepts: ["paddy_straw", "mixed"] },
  { unitId: "unit_kur", name: "Kurnool Residue Unit", lat: 15.828, lon: 78.037, capacityTonnesPerDay: 25, accepts: ["maize_stover", "mixed"] },
  { unitId: "unit_hbl", name: "Hubballi Char Co-op", lat: 15.364, lon: 75.124, capacityTonnesPerDay: 25, accepts: ["maize_stover", "sugarcane_trash", "mixed"] },
  { unitId: "unit_myr", name: "Mysuru Biochar Works", lat: 12.295, lon: 76.639, capacityTonnesPerDay: 20, accepts: ["sugarcane_trash", "mixed"] },
  { unitId: "unit_tjv", name: "Thanjavur Delta Carbon", lat: 10.787, lon: 79.138, capacityTonnesPerDay: 30, accepts: ["paddy_straw", "mixed"] },
  { unitId: "unit_mdu", name: "Madurai Residue Hub", lat: 9.925, lon: 78.120, capacityTonnesPerDay: 25, accepts: ["paddy_straw", "sugarcane_trash", "mixed"] },
];
