import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LANGUAGES, type Lang } from "../../i18n.ts";
import { KEYS, fill, renderMessage } from "./messages.ts";

/* ------------------------------------------------------------------ *
 * The assistant returns keys, so the dictionaries are the whole user
 * experience. A key the server can emit and a dictionary cannot render is a
 * blank answer on a farmer's phone - and it fails silently, which is how the
 * verifier's English `reasons` survived a four-language UI for days.
 * ------------------------------------------------------------------ */

const here = path.dirname(fileURLToPath(import.meta.url));
const LANGS = LANGUAGES.map((l) => l.code as Lang);

/** Every parameter the English template asks for, so the others can be checked against it. */
const paramsIn = (template: string): string[] =>
  [...template.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!);

describe("every assistant key renders in every language", () => {
  it("covers all four languages", () => {
    expect(LANGS.sort()).toEqual(["en", "gu", "hi", "pa"]);
  });

  it("has keys to check", () => {
    // A loop over an empty list is a green test that checks nothing.
    expect(KEYS.length).toBeGreaterThan(10);
  });

  for (const lang of LANGS) {
    it(`${lang} renders every key without leaving a raw key on screen`, () => {
      const missing = KEYS.filter((key) => {
        const out = renderMessage({ key, params: {} }, lang);
        return out === key || out.trim() === "";
      });
      expect(missing, `${lang} cannot render these`).toEqual([]);
    });
  }
});

describe("the translations say the same thing the English does", () => {
  /* A template that drops a parameter silently loses a number. "{total} lots,
     {tonnes} t" rendered without {tonnes} reads as a complete sentence and is
     simply missing the figure - nothing about it looks broken. */
  for (const lang of LANGS.filter((l) => l !== "en")) {
    it(`${lang} uses the same parameters as English, none dropped or invented`, () => {
      const wrong: string[] = [];
      for (const key of KEYS) {
        const en = paramsIn(renderMessage({ key, params: {} }, "en")).sort();
        const other = paramsIn(renderMessage({ key, params: {} }, lang)).sort();
        if (JSON.stringify(en) !== JSON.stringify(other)) {
          wrong.push(`${key}: en=[${en}] ${lang}=[${other}]`);
        }
      }
      expect(wrong).toEqual([]);
    });
  }

  /* Devanagari, Gurmukhi and Gujarati are separate Unicode blocks. A Punjabi
     string that is actually Hindi renders perfectly and is simply the wrong
     language - invisible to every other assertion here. */
  const BLOCK: Record<string, RegExp> = {
    hi: /[ऀ-ॿ]/,
    pa: /[਀-੿]/,
    gu: /[઀-૿]/,
  };

  for (const lang of ["hi", "pa", "gu"] as const) {
    it(`${lang} is actually written in its own script`, () => {
      const notInScript = KEYS.filter((key) => !BLOCK[lang]!.test(renderMessage({ key, params: {} }, lang)));
      expect(notInScript, `${lang} entries with no ${lang} characters`).toEqual([]);
    });
  }
});

describe("filling a template", () => {
  it("substitutes named parameters", () => {
    expect(fill("{a} then {b}", { a: 1, b: "two" })).toBe("1 then two");
  });

  /* Leaving the placeholder is deliberate. A parameter the server forgot shows
     up as {tonnes} in the sentence, which someone will report; silently
     rendering an empty gap reads as a finished sentence that is quietly wrong. */
  it("leaves a placeholder visible when its parameter is missing", () => {
    expect(fill("{a} and {b}", { a: 1 })).toBe("1 and {b}");
  });

  it("renders zero and false rather than treating them as absent", () => {
    expect(fill("{n} matched, {ok}", { n: 0, ok: false })).toBe("0 matched, false");
  });

  it("leaves text with no placeholders alone", () => {
    expect(fill("nothing to fill", { a: 1 })).toBe("nothing to fill");
  });
});

describe("a key with no translation degrades usefully", () => {
  /* The English TEMPLATE, not the raw key. Someone reading Punjabi who hits a
     gap gets a usable sentence with their own numbers in it. */
  it("falls back to English rather than to a key", () => {
    const out = renderMessage({ key: "assistant.lots.none", params: { district: "Ludhiana" } }, "pa");
    expect(out).toContain("Ludhiana");
    expect(out).not.toBe("assistant.lots.none");
  });

  it("returns the key itself only when nothing knows it at all", () => {
    expect(renderMessage({ key: "assistant.nonexistent", params: {} }, "en")).toBe("assistant.nonexistent");
  });
});

/* ------------------------------------------------------------------ *
 * Every key the agent can emit must be a key the client can render.
 *
 * Seventeen keys shipped emitted-but-untranslated: two people correctly
 * returned `{ key, params }` from their planning modules, and messages.ts is
 * mine and never gained their keys. Every one of them would have rendered as
 * the literal string `assistant.declare.need_tonnes` on a farmer's phone - in
 * all four languages, including English.
 *
 * Nothing caught it. The dictionary tests above check the four dictionaries
 * agree with EACH OTHER, which they did - they were consistently incomplete.
 * The agent's own tests assert on keys, which is right, and never render one.
 * The gap was exactly between two files owned by different people, which is
 * where this project keeps finding defects.
 *
 * So this reads the agent source and holds the dictionary to it.
 * ------------------------------------------------------------------ */
describe("the dictionary covers what the agent emits", () => {
  const agentSrc = path.resolve(here, "../../../../../agents/assistant/src");

  const sources = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory()
        ? sources(path.join(dir, e.name))
        : e.name.endsWith(".ts") && !e.name.endsWith(".test.ts")
          ? [path.join(dir, e.name)]
          : [],
    );

  const emitted = (): string[] => {
    const found = new Set<string>();
    for (const file of sources(agentSrc)) {
      for (const m of readFileSync(file, "utf8").matchAll(/"(assistant\.[a-z_.]+)"/g)) {
        found.add(m[1]!);
      }
    }
    return [...found].sort();
  };

  it("finds the agent source it is supposed to be reading", () => {
    // A glob that matches nothing is a green test that checks nothing.
    expect(sources(agentSrc).length).toBeGreaterThan(4);
    expect(emitted().length).toBeGreaterThan(20);
  });

  it("has an English entry for every key the agent can return", () => {
    const missing = emitted().filter((key) => !KEYS.includes(key));
    expect(missing, "emitted by an agent, absent from messages.ts").toEqual([]);
  });

  /* The other direction is a warning, not a failure: a key may legitimately
     outlive its last caller for a release. It is listed so it can be removed
     deliberately rather than accumulating. */
  it("reports dictionary keys nothing emits any more", () => {
    const orphans = KEYS.filter((key) => !emitted().includes(key));
    if (orphans.length) console.warn(`  messages.ts keys with no emitter: ${orphans.join(", ")}`);
    expect(Array.isArray(orphans)).toBe(true);
  });
});
