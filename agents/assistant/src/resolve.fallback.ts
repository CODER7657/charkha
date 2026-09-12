import { FeedstockClass, type AssistantLang, type AssistantSlots } from "@charkha/core";
import type { Resolve } from "./answer.ts";

/* ------------------------------------------------------------------ *
 * OWNER: core — and this is a STAND-IN, not the real thing.
 *
 * #62 is Hem's: four languages, proper slot extraction across Devanagari and
 * Gurmukhi numerals, and an optional ONNX embedding tier for phrasings nobody
 * anticipated. This file exists only so Saathi can answer something before
 * that lands, and it is deliberately the narrow version:
 *
 *   - English only. It does not pretend otherwise: a Punjabi sentence returns
 *     `unknown` rather than a confident guess from an English keyword that
 *     happened to appear.
 *   - Patterns, not understanding. Anything outside them is `unknown`.
 *
 * When Hem's `resolve.ts` lands, one line in answer.ts changes and this file
 * is deleted. It is not a foundation to build on.
 *
 * THE RULE THAT SURVIVES EITHER WAY: a sentence that is not clearly a request
 * to change something must never resolve to an intent that changes something.
 * The confidence gate above the planner enforces it, but a resolver that
 * guesses `retire_credit` at 0.9 defeats the gate by lying to it.
 * ------------------------------------------------------------------ */

/** Real districts, from the units we seed. A guessed district silently answers about the wrong place. */
const DISTRICTS = [
  "Ludhiana", "Patiala", "Barnala", "Karnal", "Kaithal",
  "Amritsar", "Ferozepur", "Fazilka", "Bathinda", "Anandpur Sahib",
  "Hoshiarpur", "Kurukshetra",
];

const FEEDSTOCK_WORDS: Array<[RegExp, string]> = [
  [/\b(paddy|rice)\s*(straw)?\b/i, "paddy_straw"],
  [/\bwheat\s*(straw)?\b/i, "wheat_straw"],
  [/\b(sugar\s*cane|sugarcane)\b/i, "sugarcane_trash"],
  [/\b(maize|corn)\b/i, "maize_stover"],
  [/\bmixed\b/i, "mixed"],
];

const findDistrict = (text: string): string | undefined =>
  DISTRICTS.find((d) => new RegExp(`\\b${d}\\b`, "i").test(text));

const findFeedstock = (text: string): AssistantSlots["feedstock"] => {
  for (const [re, value] of FEEDSTOCK_WORDS) {
    if (re.test(text)) return FeedstockClass.parse(value);
  }
  return undefined;
};

/** "3 t", "4.5 tonnes", "12 ton". Requires a unit: a bare number is as likely to be a radius or a year. */
const findTonnes = (text: string): number | undefined => {
  const m = /(\d+(?:\.\d+)?)\s*(?:t\b|tonne|tonnes|ton|tons)/i.exec(text);
  const n = m ? Number(m[1]) : NaN;
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

const findRadius = (text: string): number | undefined => {
  const m = /(\d+(?:\.\d+)?)\s*(?:km|kilometre|kilometer)/i.exec(text);
  const n = m ? Number(m[1]) : NaN;
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

const findCreditId = (text: string): string | undefined => /\b(crd_[A-Za-z0-9]+)\b/.exec(text)?.[1];
const findLotId = (text: string): string | undefined => /\b(lot_[A-Za-z0-9_.]+)\b/.exec(text)?.[1];

const slotsIn = (text: string): AssistantSlots => {
  const slots: AssistantSlots = {};
  const district = findDistrict(text);
  const feedstock = findFeedstock(text);
  const tonnes = findTonnes(text);
  const radiusKm = findRadius(text);
  const creditId = findCreditId(text);
  const lotId = findLotId(text);
  if (district) slots.district = district;
  if (feedstock) slots.feedstock = feedstock;
  if (tonnes !== undefined) slots.tonnes = tonnes;
  if (radiusKm !== undefined) slots.radiusKm = radiusKm;
  if (creditId) slots.creditId = creditId;
  if (lotId) slots.lotId = lotId;
  return slots;
};

/**
 * Order matters. The first rule that matches wins, so the two that change
 * state are tested FIRST and require an explicit verb - otherwise "what
 * happened to the waste I declared" would resolve to `declare_waste`.
 */
const RULES: Array<{ intent: Parameters<Resolve> extends never ? never : string; re: RegExp }> = [
  { intent: "retire_credit", re: /\bretire\b/i },
  { intent: "declare_waste", re: /\b(declare|declaring|we have|i have)\b.*\b(waste|straw|residue|stubble|t\b|tonne)/i },
  { intent: "run_matching", re: /\b(run|do|start)?\s*match(ing)?\b|\bfind (a )?unit\b/i },
  { intent: "credit_status", re: /\bcrd_[A-Za-z0-9]+\b|\bcredit\b/i },
  { intent: "impact_summary", re: /\b(co2|co₂|carbon|sequester|sequestered|impact|tco2e)\b/i },
  { intent: "lot_status", re: /\b(waste|lot|lots|straw|residue|stubble|happened)\b/i },
  { intent: "how_it_works", re: /\bhow (does|do) (this|it|you)\b|\bwhat (is|does) (this|charkha)\b/i },
];

/** Only English. Anything else is `unknown` rather than a guess from a stray keyword. */
export const resolveFallback: Resolve = (utterance: string, lang: AssistantLang) => {
  const text = utterance.trim();
  const slots = slotsIn(text);

  if (lang !== "en" || text.length === 0) {
    return { intent: "unknown", slots, confidence: 0 };
  }

  for (const rule of RULES) {
    if (!rule.re.test(text)) continue;

    /* A mutating intent needs its object named. "retire" alone is someone
       thinking out loud; "retire crd_abc" is an instruction. Without this the
       planner would propose a retirement with no credit, which is noise at
       best and alarming at worst. */
    if (rule.intent === "retire_credit" && !slots.creditId) {
      return { intent: "unknown", slots, confidence: 0 };
    }
    if (rule.intent === "declare_waste" && slots.tonnes === undefined) {
      return { intent: "unknown", slots, confidence: 0 };
    }

    /* 0.8, not 1. A pattern match is evidence, not certainty, and leaving
       headroom keeps the number meaningful when Hem's resolver replaces this
       with something that can actually be more or less sure. */
    return { intent: rule.intent as never, slots, confidence: 0.8 };
  }

  return { intent: "unknown", slots, confidence: 0 };
};
