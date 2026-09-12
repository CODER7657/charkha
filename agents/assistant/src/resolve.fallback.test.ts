import { describe, it, expect } from "vitest";
import { resolveFallback } from "./resolve.fallback.ts";

/* ------------------------------------------------------------------ *
 * A stand-in for #62, held to the one rule that survives its replacement:
 *
 *   a sentence that is not clearly a request to change something must never
 *   resolve to an intent that changes something.
 *
 * The confidence gate above the planner enforces that, but a resolver which
 * returns `retire_credit` at 0.8 defeats the gate by lying to it. So most of
 * this file is about what must NOT resolve.
 * ------------------------------------------------------------------ */

const r = (utterance: string, lang: "en" | "hi" | "pa" | "gu" = "en") => resolveFallback(utterance, lang);

describe("questions resolve to reads", () => {
  const cases: Array<[string, string]> = [
    ["what happened to our waste in Ludhiana", "lot_status"],
    ["where did the stubble from Bathinda go", "lot_status"],
    ["how much CO2 has Ludhiana sequestered", "impact_summary"],
    ["carbon impact for Patiala", "impact_summary"],
    ["is credit crd_abc123 still live", "credit_status"],
    ["how does this work", "how_it_works"],
  ];

  for (const [utterance, intent] of cases) {
    it(`"${utterance}" -> ${intent}`, () => {
      const out = r(utterance);
      expect(out.intent).toBe(intent);
      expect(out.confidence).toBeGreaterThan(0.5);
    });
  }

  it("picks the district out of the sentence", () => {
    expect(r("what happened to our waste in Ludhiana").slots.district).toBe("Ludhiana");
  });

  /* A guessed district silently answers about the wrong place, which is worse
     than asking - the planner already has a "which district?" reply for this. */
  it("leaves the district unset rather than guessing one", () => {
    expect(r("what happened to our waste").slots.district).toBeUndefined();
  });

  it("finds a credit id anywhere in the sentence", () => {
    expect(r("can you check crd_16652a1b for me").slots.creditId).toBe("crd_16652a1b");
  });
});

describe("only an instruction changes anything", () => {
  it("retires when the credit is named", () => {
    const out = r("retire crd_abc123 for our 2026 report");
    expect(out.intent).toBe("retire_credit");
    expect(out.slots.creditId).toBe("crd_abc123");
  });

  /* THE ONE THIS FILE EXISTS FOR. "retire" alone is someone thinking out
     loud. Proposing a retirement with no credit attached is noise at best and
     alarming at worst. */
  it("refuses to retire when nothing is named", () => {
    for (const u of ["retire", "retire my credit", "I want to retire something", "can I retire a credit?"]) {
      const out = r(u);
      expect(out.intent, u).toBe("unknown");
      expect(out.confidence, u).toBe(0);
    }
  });

  it("declares when a quantity is given", () => {
    const out = r("we have 4.5 t of mixed waste in Karnal");
    expect(out.intent).toBe("declare_waste");
    expect(out.slots.tonnes).toBe(4.5);
    expect(out.slots.feedstock).toBe("mixed");
    expect(out.slots.district).toBe("Karnal");
  });

  it("refuses to declare without a quantity", () => {
    for (const u of ["declare some waste", "we have waste", "I have straw"]) {
      expect(r(u).intent, u).toBe("unknown");
    }
  });

  /* A bare number is as likely to be a radius or a year as a tonnage. */
  it("does not read a unitless number as tonnes", () => {
    expect(r("we have 2026 waste").slots.tonnes).toBeUndefined();
  });

  it("reads a radius when one is given, and does not confuse it with tonnes", () => {
    const out = r("run matching at 75 km");
    expect(out.intent).toBe("run_matching");
    expect(out.slots.radiusKm).toBe(75);
    expect(out.slots.tonnes).toBeUndefined();
  });

  /* The mutating rules are tested first, so a question ABOUT declaring must
     not trip the declare rule. */
  it("a question about declared waste is still a question", () => {
    const out = r("what happened to the waste we declared in Karnal");
    expect(out.intent).not.toBe("declare_waste");
    expect(out.intent).not.toBe("retire_credit");
  });
});

describe("it does not pretend to speak languages it cannot", () => {
  /* Returning `unknown` for Punjabi is honest. Matching an English keyword
     that happened to appear in a Punjabi sentence and answering confidently
     would be worse than silence - and this is exactly what #62 replaces. */
  for (const lang of ["hi", "pa", "gu"] as const) {
    it(`${lang} resolves to unknown rather than a guess`, () => {
      const out = r("ਸਾਡੇ ਕੂੜੇ ਦਾ ਕੀ ਹੋਇਆ", lang);
      expect(out.intent).toBe("unknown");
      expect(out.confidence).toBe(0);
    });
  }

  it("does not answer an English keyword inside a non-English request", () => {
    expect(r("credit crd_abc123 ਬਾਰੇ ਦੱਸੋ", "pa").intent).toBe("unknown");
  });
});

describe("nonsense is nonsense", () => {
  for (const u of ["", "   ", "asdfgh", "hello", "what is the weather", "42"]) {
    it(`"${u}" -> unknown`, () => {
      const out = r(u);
      expect(out.intent).toBe("unknown");
      expect(out.confidence).toBe(0);
    });
  }

  /* Confidence is capped below certainty on purpose: a pattern match is
     evidence, not proof, and the number has to stay meaningful when a
     resolver that can genuinely be more or less sure replaces this one. */
  it("never claims certainty", () => {
    expect(r("what happened to our waste in Ludhiana").confidence).toBeLessThan(1);
  });
});
