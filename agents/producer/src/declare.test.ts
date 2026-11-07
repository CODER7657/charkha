import { describe, it, expect } from "vitest";
import type { BurnDetection, DeclareWasteInput } from "@charkha/core";
import { ResidueLot } from "@charkha/core";
import { toLot } from "./firms.ts";
import { DECLARED_PRODUCER_PREFIX, declarerId, toDeclaredLot } from "./declare.ts";

/* ------------------------------------------------------------------ *
 * THE TWO SUPPLY PATHS MUST NOT BE CONFUSABLE.
 *
 * A satellite detection is independent evidence. A declaration is a claim by
 * somebody who stands to be paid for it. Both belong in the system and
 * neither may wear the other's clothes - so these tests drive BOTH paths and
 * check the distinction from both ends, because a guarantee checked in one
 * direction only is half a guarantee.
 * ------------------------------------------------------------------ */

const NOW = new Date("2026-09-12T09:00:00.000Z");

const declaration: DeclareWasteInput = {
  declaredBy: "Ward 7, Ludhiana Municipal Corporation",
  feedstock: "mixed",
  tonnes: 4.5,
  at: { lat: 30.9, lon: 75.86 },
  district: "Ludhiana",
};

const detection: BurnDetection = {
  detectionId: "det_abc123",
  at: { lat: 30.9, lon: 75.86 },
  acquiredAt: "2026-10-14T06:42:00.000Z",
  satellite: "N20",
  confidence: "nominal",
  frp: 12.5,
  district: "Ludhiana",
};

describe("a declared lot", () => {
  const lot = toDeclaredLot(declaration, { lotId: "lot_declared_1", now: NOW });

  it("is marked declared and carries no detection, ever", () => {
    expect(lot.origin).toBe("declared");
    expect(lot.sourceDetectionId).toBeNull();
  });

  /* The input cannot even express a detection id, so this is belt and braces
     against somebody widening it later and the extra field flowing through. */
  it("cannot be given a detection id through the input", () => {
    const smuggled = { ...declaration, sourceDetectionId: "det_abc123" } as DeclareWasteInput;
    expect(toDeclaredLot(smuggled, { lotId: "lot_x", now: NOW }).sourceDetectionId).toBeNull();
  });

  it("is a lot like any other, and satisfies the same contract", () => {
    const parsed = ResidueLot.parse(lot);
    expect(parsed.status).toBe("listed");
    expect(parsed.tonnes).toBe(4.5);
    expect(parsed.district).toBe("Ludhiana");
    expect(parsed.at).toEqual({ lat: 30.9, lon: 75.86 });
  });

  it("is available now unless the declarer said otherwise", () => {
    expect(lot.availableFrom).toBe(NOW.toISOString());
    const later = toDeclaredLot(
      { ...declaration, availableFrom: "2026-09-15T06:00:00Z" },
      { lotId: "lot_y", now: NOW },
    );
    expect(later.availableFrom).toBe("2026-09-15T06:00:00.000Z");
  });

  /* The row that gets stored and the lot that gets returned have to be the
     same moment spelled the same way, or a caller comparing them sees a
     difference that is not there. */
  it("normalises the moment rather than echoing the spelling it was given", () => {
    const lots = ["2026-09-15T06:00:00Z", "2026-09-15T06:00:00.000Z"].map((availableFrom) =>
      toDeclaredLot({ ...declaration, availableFrom }, { lotId: "lot_z", now: NOW }).availableFrom,
    );
    expect(new Set(lots).size).toBe(1);
  });
});

describe("an ingested lot", () => {
  const lot = toLot(detection);

  it("says detected out loud rather than relying on a default", () => {
    expect(lot.origin).toBe("detected");
  });

  it("always names the detection it came from", () => {
    expect(lot.sourceDetectionId).toBe("det_abc123");
  });
});

describe("neither path can be mistaken for the other", () => {
  it("a lot with a detection is detected, and one without is declared", () => {
    const pairs = [toLot(detection), toDeclaredLot(declaration, { lotId: "lot_d", now: NOW })];
    for (const lot of pairs) {
      expect(lot.origin === "declared").toBe(lot.sourceDetectionId === null);
      expect(lot.origin === "detected").toBe(lot.sourceDetectionId !== null);
    }
  });
});

/* ------------------------------------------------------------------ *
 * The producer id is who gets paid: the registry reads it through
 * findLotProducer and writes it into the credential as `holder`, and only
 * the holder can retire that credit.
 * ------------------------------------------------------------------ */

describe("who a declaration belongs to", () => {
  it("is stable, so the same ward declaring twice is one identity", () => {
    expect(declarerId("Ward 7, Ludhiana Municipal Corporation")).toBe(
      declarerId("Ward 7, Ludhiana Municipal Corporation"),
    );
  });

  it("reads the declarer back out of the id", () => {
    expect(declarerId("Ward 7, Ludhiana Municipal Corporation")).toBe(
      "decl_ward_7_ludhiana_municipal_corporation",
    );
  });

  it("treats spellings of one body as one body", () => {
    const spellings = ["Ward 7", "ward-7", "  WARD  7  ", "Ward #7"];
    expect(new Set(spellings.map(declarerId)).size).toBe(1);
  });

  it("tells two different declarers apart", () => {
    expect(declarerId("Ward 7")).not.toBe(declarerId("Ward 8"));
  });

  /* Four languages ship on the field screen. Stripping to ASCII would give
     every Punjabi and Gujarati declarer the same empty slug, and then an
     opaque hash, while English ones stayed readable. */
  it("keeps a declarer's own script, matras and all", () => {
    /* Written out in full rather than as a `toContain`, because the bug this
       pins was a SUBSTRING that still contained the right letters. Indic
       vowel signs are combining marks, not letters: keeping \p{L} and \p{N}
       alone turned ਵਾਰਡ into ਵ_ਰਡ and ਲੁਧਿਆਣਾ into ਲ_ਧ_ਆਣ - a declarer's name
       mangled into something they would not recognise as theirs, while every
       English assertion in this file passed. */
    expect(declarerId("ਵਾਰਡ 7, ਲੁਧਿਆਣਾ")).toBe("decl_ਵਾਰਡ_7_ਲੁਧਿਆਣਾ");
    expect(declarerId("वार्ड 7, लुधियाना")).toBe("decl_वार्ड_7_लुधियाना");
    expect(declarerId("વોર્ડ 7")).toBe("decl_વોર્ડ_7");
  });

  it("never returns a bare prefix, however unslugable the name", () => {
    for (const name of ["!!!", "---", "…", "###"]) {
      const id = declarerId(name);
      expect(id, name).not.toBe(`${DECLARED_PRODUCER_PREFIX}_`);
      expect(id.length, name).toBeGreaterThan(DECLARED_PRODUCER_PREFIX.length + 1);
    }
    // Still different bodies, even when neither slugs.
    expect(declarerId("!!!")).not.toBe(declarerId("---"));
  });

  it("stays a sane length for a name that is a paragraph", () => {
    const id = declarerId("A".repeat(120));
    expect(id.length).toBeLessThanOrEqual(DECLARED_PRODUCER_PREFIX.length + 1 + 60);
  });

  it("never ends in a separator", () => {
    for (const name of ["Ward 7!!!", "Ward 7 ", "Ward 7 -"]) {
      expect(declarerId(name).endsWith("_"), name).toBe(false);
    }
  });
});
