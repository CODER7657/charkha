import { describe, expect, it } from "vitest";
import type { AssistantIntent, AssistantLang } from "@charkha/core";
import { MUTATING_FLOOR, UNKNOWN_FLOOR, resolve } from "./resolve.ts";

/* ------------------------------------------------------------------ *
 * OWNER: Hem
 *
 * Intent resolution, held to the rule that matters: a wrong answer here is
 * quiet and confident. Nothing downstream can tell a good guess from a bad
 * one, so the guarantees below are the whole point of the module.
 *
 * Asserted on intent, slots and confidence bands - never on wording. The
 * phrasings are examples, not a spec; the day someone rewords one of these
 * the test should still describe what must happen.
 * ------------------------------------------------------------------ */

type Case = {
  utterance: string;
  lang: AssistantLang;
  intent: AssistantIntent;
  /** Only the slots this sentence genuinely carries. */
  slots?: Record<string, unknown>;
};

/* ---------- the seven real intents, in all four languages ---------- */

const CASES: Case[] = [
  // lot_status
  { utterance: "what happened to my waste", lang: "en", intent: "lot_status" },
  { utterance: "हमारे कचरे का क्या हुआ", lang: "hi", intent: "lot_status" },
  { utterance: "ਸਾਡੇ ਕੂੜੇ ਦਾ ਕੀ ਹੋਇਆ?", lang: "pa", intent: "lot_status" },
  { utterance: "અમારા કચરાનું શું થયું", lang: "gu", intent: "lot_status" },
  { utterance: "status of lot_n20_29.9_74.9", lang: "en", intent: "lot_status", slots: { lotId: "lot_n20_29.9_74.9" } },

  // declare_waste
  {
    utterance: "3 tonnes of paddy straw in Ludhiana",
    lang: "en",
    intent: "declare_waste",
    slots: { tonnes: 3, feedstock: "paddy_straw", district: "Ludhiana" },
  },
  {
    utterance: "3 टन पराली लुधियाना में",
    lang: "hi",
    intent: "declare_waste",
    slots: { tonnes: 3, feedstock: "paddy_straw", district: "Ludhiana" },
  },
  {
    utterance: "ਸਾਡੇ ਕੋਲ ੩ ਟਨ ਝੋਨੇ ਦੀ ਪਰਾਲੀ ਹੈ ਲੁਧਿਆਣਾ ਵਿੱਚ",
    lang: "pa",
    intent: "declare_waste",
    slots: { tonnes: 3, feedstock: "paddy_straw", district: "Ludhiana" },
  },
  {
    utterance: "લુધિયાણામાં ૩ ટન ડાંગરની પરાળ છે",
    lang: "gu",
    intent: "declare_waste",
    slots: { tonnes: 3, feedstock: "paddy_straw", district: "Ludhiana" },
  },

  // run_matching
  { utterance: "match my lots", lang: "en", intent: "run_matching" },
  { utterance: "मिलान चलाओ", lang: "hi", intent: "run_matching" },
  { utterance: "ਮਿਲਾਨ ਚਲਾਓ", lang: "pa", intent: "run_matching" },
  { utterance: "મેચિંગ ચલાવો", lang: "gu", intent: "run_matching" },
  { utterance: "find a unit for my straw", lang: "en", intent: "run_matching" },

  // credit_status
  {
    utterance: "is credit crd_d17eb9d2cd204ed497c5 still live",
    lang: "en",
    intent: "credit_status",
    slots: { creditId: "crd_d17eb9d2cd204ed497c5" },
  },
  {
    utterance: "crd_d17eb9d2cd204ed497c5 की स्थिति क्या है",
    lang: "hi",
    intent: "credit_status",
    slots: { creditId: "crd_d17eb9d2cd204ed497c5" },
  },
  {
    utterance: "crd_d17eb9d2cd204ed497c5 ਦੀ ਹਾਲਤ ਕੀ ਹੈ",
    lang: "pa",
    intent: "credit_status",
    slots: { creditId: "crd_d17eb9d2cd204ed497c5" },
  },
  {
    utterance: "crd_d17eb9d2cd204ed497c5 ની સ્થિતિ શું છે",
    lang: "gu",
    intent: "credit_status",
    slots: { creditId: "crd_d17eb9d2cd204ed497c5" },
  },

  // retire_credit
  {
    utterance: "retire crd_d17eb9d2cd204ed497c5 for our 2026 report",
    lang: "en",
    intent: "retire_credit",
    slots: { creditId: "crd_d17eb9d2cd204ed497c5" },
  },
  {
    utterance: "crd_d17eb9d2cd204ed497c5 को रिटायर करो",
    lang: "hi",
    intent: "retire_credit",
    slots: { creditId: "crd_d17eb9d2cd204ed497c5" },
  },
  {
    utterance: "crd_d17eb9d2cd204ed497c5 ਨੂੰ ਰਿਟਾਇਰ ਕਰੋ",
    lang: "pa",
    intent: "retire_credit",
    slots: { creditId: "crd_d17eb9d2cd204ed497c5" },
  },
  {
    utterance: "crd_d17eb9d2cd204ed497c5 ને રિટાયર કરો",
    lang: "gu",
    intent: "retire_credit",
    slots: { creditId: "crd_d17eb9d2cd204ed497c5" },
  },

  // impact_summary
  { utterance: "how much CO2 from Ludhiana", lang: "en", intent: "impact_summary", slots: { district: "Ludhiana" } },
  { utterance: "लुधियाना से कितनी CO2 बची", lang: "hi", intent: "impact_summary", slots: { district: "Ludhiana" } },
  { utterance: "ਕੁੱਲ ਕਿੰਨੀ CO2 ਬਚੀ", lang: "pa", intent: "impact_summary" },
  { utterance: "કુલ કેટલી CO2 બચી", lang: "gu", intent: "impact_summary" },

  // how_it_works
  { utterance: "how does this work", lang: "en", intent: "how_it_works" },
  { utterance: "यह कैसे काम करता है", lang: "hi", intent: "how_it_works" },
  { utterance: "ਇਹ ਕਿਵੇਂ ਕੰਮ ਕਰਦਾ ਹੈ", lang: "pa", intent: "how_it_works" },
  { utterance: "આ કેવી રીતે કામ કરે છે", lang: "gu", intent: "how_it_works" },
];

/* ---------- sentences that MUST land on unknown ---------- *
 * `unknown` is a success. Ten honest refusals beat one confident guess. */

const UNKNOWN_CASES: Case[] = [
  { utterance: "asdkjh qwe zxcvb", lang: "en", intent: "unknown" },
  { utterance: "!!!", lang: "en", intent: "unknown" },
  { utterance: "what is the weather tomorrow", lang: "en", intent: "unknown" },
  { utterance: "कल मौसम कैसा रहेगा", lang: "hi", intent: "unknown" },
  { utterance: "book me a train to Delhi", lang: "en", intent: "unknown" },
  { utterance: "ਮੈਨੂੰ ਇੱਕ ਗੀਤ ਸੁਣਾਓ", lang: "pa", intent: "unknown" },
];

/** Looks like a write, names nothing. The dangerous shape. */
const AMBIGUOUS_WRITES: Case[] = [
  { utterance: "retire it", lang: "en", intent: "unknown" },
  { utterance: "do the thing", lang: "en", intent: "unknown" },
  { utterance: "रिटायर", lang: "hi", intent: "unknown" },
  { utterance: "ਕਰ ਦਿਓ", lang: "pa", intent: "unknown" },
  { utterance: "declare", lang: "en", intent: "unknown" },
];

const ALL = [...CASES, ...UNKNOWN_CASES, ...AMBIGUOUS_WRITES];

describe("resolve - the seven real intents, four languages", () => {
  it.each(CASES.map((c) => [c.lang, c.utterance, c.intent, c] as const))(
    "[%s] %s -> %s",
    (_lang, _utterance, _intent, c) => {
      const r = resolve(c.utterance, c.lang);
      expect(r.intent).toBe(c.intent);
      expect(r.confidence).toBeGreaterThanOrEqual(UNKNOWN_FLOOR);
      for (const [k, v] of Object.entries(c.slots ?? {})) {
        expect(r.slots[k as keyof typeof r.slots], `slot ${k}`).toBe(v);
      }
    },
  );
});

describe("resolve - unknown is a success, not a failure", () => {
  it.each([...UNKNOWN_CASES, ...AMBIGUOUS_WRITES].map((c) => [c.lang, c.utterance, c] as const))(
    "[%s] %s -> unknown",
    (_lang, _utterance, c) => {
      const r = resolve(c.utterance, c.lang);
      expect(r.intent).toBe("unknown");
      expect(r.confidence).toBeLessThan(UNKNOWN_FLOOR);
    },
  );

  it("an empty utterance is unknown rather than a crash", () => {
    expect(resolve("", "en").intent).toBe("unknown");
    expect(resolve("   ", "en").intent).toBe("unknown");
  });
});

/* ---------- the guarantee ---------- *
 * Two intents can change state. A coin flip must not reach either. */

describe("the guarantee: a coin flip never writes", () => {
  const MUTATING: AssistantIntent[] = ["declare_waste", "retire_credit"];

  it("no utterance in the whole corpus yields a mutating intent below the mutating floor", () => {
    for (const c of ALL) {
      const r = resolve(c.utterance, c.lang);
      if (MUTATING.includes(r.intent)) {
        expect(r.confidence, `"${c.utterance}" resolved ${r.intent}`).toBeGreaterThanOrEqual(MUTATING_FLOOR);
      }
    }
  });

  it("anything below the unknown floor is reported as unknown, never as a real intent", () => {
    for (const c of ALL) {
      const r = resolve(c.utterance, c.lang);
      if (r.confidence < UNKNOWN_FLOOR) {
        expect(r.intent, `"${c.utterance}"`).toBe("unknown");
      }
    }
  });

  it("the mutating floor is strictly higher than the unknown floor", () => {
    expect(MUTATING_FLOOR).toBeGreaterThan(UNKNOWN_FLOOR);
  });

  it("a bare verb with no object never reaches a write", () => {
    for (const u of ["retire", "retire it", "declare", "declare waste", "रिटायर करो", "ਰਿਟਾਇਰ"]) {
      const r = resolve(u, "en");
      expect(MUTATING.includes(r.intent), `"${u}" resolved ${r.intent}`).toBe(false);
    }
  });

  it("confidence is always a probability", () => {
    for (const c of ALL) {
      const r = resolve(c.utterance, c.lang);
      expect(r.confidence).toBeGreaterThanOrEqual(0);
      expect(r.confidence).toBeLessThanOrEqual(1);
    }
  });
});

/* ---------- slots ---------- */

describe("tonnes, including the numerals that silently fail", () => {
  const tonnes = (u: string, lang: AssistantLang = "en") => resolve(u, lang).slots.tonnes;

  it("reads Latin digits, whole and decimal", () => {
    expect(tonnes("3 tonnes of paddy straw in Ludhiana")).toBe(3);
    expect(tonnes("3.5 t of wheat straw in Moga")).toBe(3.5);
  });

  it("reads Devanagari digits", () => {
    expect(tonnes("३ टन पराली लुधियाना में", "hi")).toBe(3);
    expect(tonnes("२.५ टन पराली लुधियाना में", "hi")).toBe(2.5);
  });

  it("reads Gurmukhi digits", () => {
    expect(tonnes("੩ ਟਨ ਪਰਾਲੀ ਲੁਧਿਆਣਾ ਵਿੱਚ", "pa")).toBe(3);
  });

  it("reads Gujarati digits", () => {
    expect(tonnes("લુધિયાણામાં ૩ ટન ડાંગરની પરાળ છે", "gu")).toBe(3);
  });

  it("reads spelled-out quantities", () => {
    expect(tonnes("saadhe teen tan paddy straw in Ludhiana")).toBe(3.5);
    expect(tonnes("two tonnes of wheat straw in Moga")).toBe(2);
  });

  it("refuses a quantity that is not a plausible tonnage", () => {
    expect(tonnes("99999 tonnes of paddy straw in Ludhiana")).toBeUndefined();
    expect(tonnes("0 tonnes of paddy straw in Ludhiana")).toBeUndefined();
  });

  it("does not mistake a year or an id for a tonnage", () => {
    expect(resolve("retire crd_d17eb9d2cd204ed497c5 for our 2026 report", "en").slots.tonnes).toBeUndefined();
  });
});

describe("feedstock, by the same words the field view already uses", () => {
  const fs = (u: string, lang: AssistantLang) => resolve(u, lang).slots.feedstock;

  it("maps the local name in each language", () => {
    expect(fs("3 t of paddy straw in Ludhiana", "en")).toBe("paddy_straw");
    expect(fs("३ टन धान की पराली लुधियाना में", "hi")).toBe("paddy_straw");
    expect(fs("੩ ਟਨ ਕਣਕ ਦਾ ਨਾੜ ਮੋਗਾ ਵਿੱਚ", "pa")).toBe("wheat_straw");
    expect(fs("૩ ટન શેરડીના પાન", "gu")).toBe("sugarcane_trash");
  });

  it("understands the bare colloquial word for paddy straw", () => {
    expect(fs("३ टन पराली लुधियाना में", "hi")).toBe("paddy_straw");
    expect(fs("੩ ਟਨ ਪਰਾਲੀ ਲੁਧਿਆਣਾ ਵਿੱਚ", "pa")).toBe("paddy_straw");
  });

  it("leaves feedstock unset when none is named", () => {
    expect(fs("match my lots", "en")).toBeUndefined();
  });

  /* People type Hinglish. "saadhe teen tan parali" is one sentence, not a
     script boundary, and the quantity half already works - so the feedstock
     half failing means the whole declaration is silently refused. */
  it("maps the romanised names people actually type", () => {
    expect(fs("saadhe teen tan parali Ludhiana", "en")).toBe("paddy_straw");
    expect(fs("2 tan kanak Moga", "en")).toBe("wheat_straw");
    expect(fs("3 tan ganna Patiala", "en")).toBe("sugarcane_trash");
    expect(fs("4 tan makki Karnal", "en")).toBe("maize_stover");
  });
});

describe("a Hinglish declaration resolves, it does not silently refuse", () => {
  it("reads quantity, feedstock and district from one romanised sentence", () => {
    const r = resolve("saadhe teen tan parali Ludhiana", "en");
    expect(r.intent).toBe("declare_waste");
    expect(r.slots.tonnes).toBe(3.5);
    expect(r.slots.feedstock).toBe("paddy_straw");
    expect(r.slots.district).toBe("Ludhiana");
    expect(r.confidence).toBeGreaterThanOrEqual(MUTATING_FLOOR);
  });
});

describe("district, from the list the producer actually uses", () => {
  const d = (u: string, lang: AssistantLang) => resolve(u, lang).slots.district;

  it("reads a district in each script", () => {
    expect(d("3 t paddy straw in Ludhiana", "en")).toBe("Ludhiana");
    expect(d("३ टन पराली लुधियाना में", "hi")).toBe("Ludhiana");
    expect(d("੩ ਟਨ ਪਰਾਲੀ ਲੁਧਿਆਣਾ ਵਿੱਚ", "pa")).toBe("Ludhiana");
    expect(d("લુધિયાણામાં ૩ ટન પરાળ", "gu")).toBe("Ludhiana");
  });

  it("reads a two-word district", () => {
    expect(d("how much CO2 from Tarn Taran", "en")).toBe("Tarn Taran");
  });

  it("does not invent a district that is not on the belt", () => {
    expect(d("3 t paddy straw in Mumbai", "en")).toBeUndefined();
  });
});

describe("ids, by shape", () => {
  it("tells lot, credit, match and task ids apart", () => {
    expect(resolve("status of lot_n20_29.9_74.9", "en").slots.lotId).toBe("lot_n20_29.9_74.9");
    expect(resolve("is crd_d17eb9d2cd204ed497c5 live", "en").slots.creditId).toBe("crd_d17eb9d2cd204ed497c5");
    expect(resolve("trace d79900f0-3734-4a50-a53b-035794cd71d8", "en").slots.taskId).toBe(
      "d79900f0-3734-4a50-a53b-035794cd71d8",
    );
  });

  it("does not put a credit id in the lot slot", () => {
    const r = resolve("retire crd_d17eb9d2cd204ed497c5", "en");
    expect(r.slots.lotId).toBeUndefined();
  });
});
