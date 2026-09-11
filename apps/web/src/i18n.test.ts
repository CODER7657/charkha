import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { LANGUAGES, detectLang, rememberLang, translator, type Lang } from "./i18n.ts";

/* ------------------------------------------------------------------ *
 * The Field view is the only screen a farmer touches, and it is the one
 * screen where a wrong string is not cosmetic - it is someone submitting
 * the wrong feedstock, or not submitting at all.
 * ------------------------------------------------------------------ */

const CODES = LANGUAGES.map((l) => l.code);

/* Every key that appears on a control a user has to act on. If one of these
   falls back to English in a non-English language, that control is unusable
   for the person it was translated for. */
const MUST_TRANSLATE = [
  "Field capture",
  "Submit",
  "Use device location",
  "Latitude",
  "Longitude",
  "Feedstock",
  "Peak temperature",
  "Residence time",
  "Output tonnes",
  "Offline",
  "Online",
  "Waiting to send",
  "This is what leaves your phone",
  "Inference runs on this device. The photo is never uploaded, only its hash and the scores.",
  "paddy_straw",
  "wheat_straw",
  "sugarcane_trash",
  "maize_stover",
  "mixed",
];

describe("languages", () => {
  it("offers English, Hindi, Punjabi and Gujarati", () => {
    expect(CODES).toEqual(["en", "hi", "pa", "gu"]);
  });

  it("labels every language in its own script, not in English", () => {
    // Someone who cannot read "Hindi" cannot read the word Hindi either.
    for (const l of LANGUAGES.filter((x) => x.code !== "en")) {
      expect(l.native).not.toBe(l.label);
      expect(l.native.codePointAt(0)!).toBeGreaterThan(0x7f); // genuinely non-Latin
    }
  });

  it("uses the right script for each language", () => {
    const script: Record<string, RegExp> = {
      hi: /[ऀ-ॿ]/, // Devanagari
      pa: /[਀-੿]/, // Gurmukhi
      gu: /[઀-૿]/, // Gujarati
    };
    for (const [code, re] of Object.entries(script)) {
      const lang = LANGUAGES.find((l) => l.code === code)!;
      expect(re.test(lang.native)).toBe(true);
    }
  });
});

describe("translation coverage", () => {
  for (const code of CODES.filter((c) => c !== "en")) {
    it(`${code} translates every user-facing control`, () => {
      const t = translator(code as Lang);
      const missing = MUST_TRANSLATE.filter((k) => t(k) === k);
      expect(missing, `untranslated in ${code}: ${missing.join(", ")}`).toEqual([]);
    });

    it(`${code} uses its own script throughout, not another language's`, () => {
      const t = translator(code as Lang);
      /* The danda (U+0964) and double danda (U+0965) live in the Devanagari
         block but are shared sentence punctuation across Indic scripts -
         Punjabi and Gujarati use them too. Stripping them first, because the
         first version of this test flagged a correct Punjabi sentence. */
      const strip = (v: string) => v.replace(/[।॥]/g, "");
      const wrong: Record<string, RegExp> = {
        hi: /[਀-૿]/, // Devanagari must not carry Gurmukhi or Gujarati
        pa: /[ऀ-ॿ]|[઀-૿]/,
        gu: /[ऀ-ॿ]|[਀-੿]/,
      };
      const leaked = MUST_TRANSLATE.filter((k) => wrong[code]!.test(strip(t(k))));
      expect(leaked, `wrong script in ${code}: ${leaked.join(", ")}`).toEqual([]);
    });
  }

  it("English is the identity - keys are already English sentences", () => {
    const t = translator("en");
    for (const k of MUST_TRANSLATE) expect(t(k)).toBe(k);
  });

  it("an unknown key falls back to itself, so a miss reads as a sentence", () => {
    // Never a dotted.key.path in front of a farmer.
    for (const code of CODES) {
      expect(translator(code as Lang)("Some string nobody translated")).toBe(
        "Some string nobody translated",
      );
    }
  });
});

describe("choosing a language", () => {
  /* Stubbed rather than run under jsdom: these are the only two browser
     globals i18n touches, the suite stays in node, and we avoid a dependency
     for four languages and forty strings. */
  let stored: Record<string, string> = {};
  let throwOnGet = false;
  let throwOnSet = false;

  const setNav = (language: string) => vi.stubGlobal("navigator", { language });

  beforeEach(() => {
    stored = {};
    throwOnGet = false;
    throwOnSet = false;
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => {
        if (throwOnGet) throw new Error("SecurityError");
        return stored[k] ?? null;
      },
      setItem: (k: string, v: string) => {
        if (throwOnSet) throw new Error("QuotaExceededError");
        stored[k] = v;
      },
      clear: () => {
        stored = {};
      },
    });
    setNav("en-GB");
  });

  afterEach(() => vi.unstubAllGlobals());

  it("remembers an explicit choice over the phone's setting", () => {
    setNav("en-GB");
    rememberLang("pa");
    expect(detectLang()).toBe("pa");
  });

  it("falls back to the phone's language when nothing is remembered", () => {
    setNav("gu-IN");
    expect(detectLang()).toBe("gu");
  });

  it("matches on the language subtag, not the exact locale", () => {
    for (const [nav, expected] of [
      ["hi-IN", "hi"],
      ["pa-Guru-IN", "pa"],
      ["gu-IN", "gu"],
    ] as const) {
      stored = {};
      setNav(nav);
      expect(detectLang()).toBe(expected);
    }
  });

  it("is case-insensitive about the locale tag", () => {
    setNav("HI-IN");
    expect(detectLang()).toBe("hi");
  });

  it("falls back to English for a language we do not speak", () => {
    setNav("fr-FR");
    expect(detectLang()).toBe("en");
  });

  it("ignores a remembered value that is not a language we have", () => {
    localStorage.setItem("charkha.lang", "klingon");
    setNav("hi-IN");
    expect(detectLang()).toBe("hi");
  });

  it("survives storage being unavailable, as in a private window", () => {
    throwOnGet = true;
    setNav("pa-IN");
    expect(() => detectLang()).not.toThrow();
    expect(detectLang()).toBe("pa");
  });

  it("does not throw when remembering fails", () => {
    throwOnSet = true;
    expect(() => rememberLang("gu")).not.toThrow();
  });
});
