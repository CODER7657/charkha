import { describe, it, expect } from "vitest";
import {
  buildFirmsUrl,
  defaultTonnesFor,
  detectionIdOf,
  districtFor,
  estimateTonnes,
  feedstockForDate,
  isLowConfidence,
  looksLikeCsv,
  MAX_LOT_TONNES,
  MIN_LOT_TONNES,
  parseCsv,
  planIngest,
  toDetection,
  toIsoUtc,
} from "./firms.ts";

/** A real VIIRS_SNPP_NRT area-API response shape, header and column order. */
const HEADER =
  "country_id,latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_ti5,frp,daynight";

const row = (over: Partial<Record<string, string>> = {}): string => {
  const cells: Record<string, string> = {
    country_id: "IND",
    latitude: "30.8412",
    longitude: "75.7692",
    bright_ti4: "331.2",
    scan: "0.39",
    track: "0.36",
    acq_date: "2026-10-22",
    acq_time: "0812",
    satellite: "N",
    instrument: "VIIRS",
    confidence: "n",
    version: "2.0NRT",
    bright_ti5: "290.1",
    frp: "12.4",
    daynight: "D",
    ...over,
  };
  return HEADER.split(",")
    .map((h) => cells[h] ?? "")
    .join(",");
};

const csv = (...rows: string[]): string => [HEADER, ...rows].join("\n");

describe("FIRMS url", () => {
  it("puts the key, source, bbox and day range in the documented order", () => {
    const url = buildFirmsUrl({ mapKey: "KEY123", source: "VIIRS_SNPP_NRT", bbox: "73.8,29.5,77.5,32.2", dayRange: 2 });
    expect(url).toBe(
      "https://firms.modaps.eosdis.nasa.gov/api/area/csv/KEY123/VIIRS_SNPP_NRT/73.8%2C29.5%2C77.5%2C32.2/2",
    );
  });

  it("falls back to the Punjab/Haryana defaults", () => {
    expect(buildFirmsUrl({ mapKey: "K" })).toContain("VIIRS_SNPP_NRT");
  });
});

describe("csv parsing", () => {
  it("reads values by header name, not column position", () => {
    const rows = parseCsv(csv(row()));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.["latitude"]).toBe("30.8412");
    expect(rows[0]?.["frp"]).toBe("12.4");
  });

  it("survives CRLF line endings and a trailing blank line", () => {
    expect(parseCsv([HEADER, row(), ""].join("\r\n"))).toHaveLength(1);
  });

  it("returns nothing for an empty body", () => {
    expect(parseCsv("")).toEqual([]);
  });

  it("drops a truncated row rather than guessing at it", () => {
    expect(parseCsv(csv(row(), "IND,30.1,75.1"))).toHaveLength(1);
  });

  it("recognises a real CSV header and rejects an error page", () => {
    expect(looksLikeCsv(csv(row()))).toBe(true);
    expect(looksLikeCsv("Invalid MAP_KEY. Please check your key.")).toBe(false);
  });
});

describe("detection ids", () => {
  it("is stable for the same detection across runs", () => {
    const args = { satellite: "N", lat: 30.8412, lon: 75.7692, acqDate: "2026-10-22", acqTime: "0812" };
    expect(detectionIdOf(args)).toBe(detectionIdOf({ ...args }));
  });

  it("does not depend on how the time was zero-padded", () => {
    const base = { satellite: "N", lat: 30.8412, lon: 75.7692, acqDate: "2026-10-22" };
    expect(detectionIdOf({ ...base, acqTime: "607" })).toBe(detectionIdOf({ ...base, acqTime: "0607" }));
  });

  it("separates two detections that differ in any component", () => {
    const base = { satellite: "N", lat: 30.8412, lon: 75.7692, acqDate: "2026-10-22", acqTime: "0812" };
    expect(detectionIdOf(base)).not.toBe(detectionIdOf({ ...base, acqTime: "0813" }));
    expect(detectionIdOf(base)).not.toBe(detectionIdOf({ ...base, lat: 30.8413 }));
    expect(detectionIdOf(base)).not.toBe(detectionIdOf({ ...base, satellite: "N20" }));
  });
});

describe("timestamps", () => {
  it("reads FIRMS date + HHMM as UTC", () => {
    expect(toIsoUtc("2026-10-22", "0812")).toBe("2026-10-22T08:12:00.000Z");
  });
  it("pads a three-digit time", () => {
    expect(toIsoUtc("2026-10-22", "607")).toBe("2026-10-22T06:07:00.000Z");
  });
  it("refuses a malformed date or time", () => {
    expect(toIsoUtc("22-10-2026", "0812")).toBeNull();
    expect(toIsoUtc("2026-10-22", "not-a-time")).toBeNull();
  });
});

describe("confidence", () => {
  it("treats VIIRS low and MODIS sub-30 as low", () => {
    expect(isLowConfidence("l")).toBe(true);
    expect(isLowConfidence("low")).toBe(true);
    expect(isLowConfidence("12")).toBe(true);
  });
  it("keeps nominal and high", () => {
    expect(isLowConfidence("n")).toBe(false);
    expect(isLowConfidence("h")).toBe(false);
    expect(isLowConfidence("87")).toBe(false);
  });
});

describe("districts", () => {
  it("labels a point in the belt with its nearest district", () => {
    expect(districtFor({ lat: 30.9, lon: 75.86 })).toBe("Ludhiana");
    expect(districtFor({ lat: 29.69, lon: 76.99 })).toBe("Karnal");
  });
  it("says null rather than guessing for a point far outside the belt", () => {
    expect(districtFor({ lat: 13.08, lon: 80.27 })).toBeNull();
  });
});

describe("feedstock by season", () => {
  it("is paddy straw after the kharif harvest", () => {
    expect(feedstockForDate("2026-10-22T08:12:00.000Z")).toBe("paddy_straw");
    expect(feedstockForDate("2026-11-03T08:12:00.000Z")).toBe("paddy_straw");
  });
  it("is wheat straw after rabi", () => {
    expect(feedstockForDate("2026-04-18T08:12:00.000Z")).toBe("wheat_straw");
  });
  it("will not claim to know outside the two burning windows", () => {
    expect(feedstockForDate("2026-09-11T08:12:00.000Z")).toBe("mixed");
  });
});

describe("tonnage estimate", () => {
  it("derives tonnes from FRP via the fire-radiative-energy coefficient", () => {
    // 0.368 kg/MJ * 12.4 MW * 1800 s = 8213 kg
    expect(estimateTonnes({ frp: 12.4, district: "Ludhiana", feedstock: "paddy_straw" })).toBeCloseTo(8.2, 1);
  });

  it("falls back to the per-district default when FRP is missing", () => {
    const fallback = defaultTonnesFor("Ludhiana", "paddy_straw");
    expect(estimateTonnes({ frp: null, district: "Ludhiana", feedstock: "paddy_straw" })).toBe(fallback);
    // Punjab holdings are larger than Haryana's, so the default is larger.
    expect(defaultTonnesFor("Ludhiana", "paddy_straw")).toBeGreaterThan(
      defaultTonnesFor("Karnal", "paddy_straw"),
    );
  });

  it("clamps a freak FRP instead of inventing a 500 t lot", () => {
    expect(estimateTonnes({ frp: 9999, district: "Ludhiana", feedstock: "paddy_straw" })).toBe(MAX_LOT_TONNES);
    expect(estimateTonnes({ frp: 0.001, district: "Ludhiana", feedstock: "paddy_straw" })).toBe(MIN_LOT_TONNES);
  });
});

describe("row -> detection", () => {
  it("normalises a real row", () => {
    const rows = parseCsv(csv(row()));
    const d = toDetection(rows[0]!);
    expect(d).not.toBeNull();
    expect(d?.at).toEqual({ lat: 30.8412, lon: 75.7692 });
    expect(d?.acquiredAt).toBe("2026-10-22T08:12:00.000Z");
    expect(d?.frp).toBe(12.4);
    expect(d?.district).toBe("Ludhiana");
  });

  it("refuses a row with no usable coordinates", () => {
    const rows = parseCsv(csv(row({ latitude: "", longitude: "" })));
    expect(toDetection(rows[0]!)).toBeNull();
  });

  it("refuses a row with an out-of-range latitude", () => {
    const rows = parseCsv(csv(row({ latitude: "913.2" })));
    expect(toDetection(rows[0]!)).toBeNull();
  });

  it("carries a null frp through rather than defaulting it to zero", () => {
    const rows = parseCsv(csv(row({ frp: "" })));
    expect(toDetection(rows[0]!)?.frp).toBeNull();
  });
});

describe("planIngest", () => {
  const three = csv(
    row({ acq_time: "0812" }),
    row({ acq_time: "0813", latitude: "30.3390", longitude: "76.3860" }),
    row({ acq_time: "0814", latitude: "29.6860", longitude: "76.9890" }),
  );

  it("turns each new detection into exactly one lot", () => {
    const plan = planIngest(parseCsv(three), new Set());
    expect(plan.parsed).toBe(3);
    expect(plan.detections).toHaveLength(3);
    expect(plan.lots).toHaveLength(3);
    expect(plan.lots.every((l) => l.status === "listed")).toBe(true);
    expect(plan.lots.every((l) => l.tonnes > 0)).toBe(true);
    // Every lot points back at the detection it came from.
    expect(plan.lots.map((l) => l.sourceDetectionId)).toEqual(plan.detections.map((d) => d.detectionId));
  });

  /* THE DEDUPE GUARANTEE — ingest twice, same row count. */
  it("creates nothing on a second ingest of the same feed", () => {
    const first = planIngest(parseCsv(three), new Set());
    const known = new Set(first.detections.map((d) => d.detectionId));

    const second = planIngest(parseCsv(three), known);

    expect(first.lots).toHaveLength(3);
    expect(second.lots).toHaveLength(0);
    expect(second.detections).toHaveLength(0);
    expect(second.skippedDuplicate).toBe(3);
  });

  it("dedupes repeats inside a single response, not just against the database", () => {
    const plan = planIngest(parseCsv(csv(row(), row(), row())), new Set());
    expect(plan.lots).toHaveLength(1);
    expect(plan.skippedDuplicate).toBe(2);
  });

  /* THE FAILURE CASE — a low-confidence detection must not become a lot. */
  it("refuses to create a lot from a low-confidence detection", () => {
    const plan = planIngest(parseCsv(csv(row({ confidence: "l" }))), new Set());
    expect(plan.lots).toHaveLength(0);
    expect(plan.skippedLowConfidence).toBe(1);
  });

  it("skips an unreadable row and keeps going", () => {
    const plan = planIngest(parseCsv(csv(row({ latitude: "" }), row())), new Set());
    expect(plan.skippedUnparseable).toBe(1);
    expect(plan.lots).toHaveLength(1);
  });

  it("produces a stable lot id derived from the detection", () => {
    const plan = planIngest(parseCsv(csv(row())), new Set());
    expect(plan.lots[0]?.lotId).toBe(plan.detections[0]?.detectionId.replace(/^det_/, "lot_"));
  });
});
