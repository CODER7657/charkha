import { FeedstockClass, type AssistantIntent, type AssistantLang, type AssistantSlots } from "@charkha/core";

/* ------------------------------------------------------------------ *
 * OWNER: Hem
 *
 * One sentence in, one intent out. Pure: no network, no A2A, no database.
 *
 * The failure this module exists to prevent is a quiet, confident wrong
 * answer. Nothing downstream can tell a good guess from a bad one, so two
 * rules are structural rather than advisory:
 *
 *   1. `unknown` is a success. Ten honest refusals beat one confident guess.
 *   2. A mutating intent is only a CANDIDATE if its object is present.
 *      "retire it" names no credit, so it never scores as a write at all -
 *      rather than scoring high and being argued back down afterwards.
 *
 * Language is a hint, not a filter. Every vocabulary is searched whatever
 * `lang` says, because people mix scripts and a wrong `lang` should degrade
 * the answer, not break it.
 * ------------------------------------------------------------------ */

export type Resolution = {
  intent: AssistantIntent;
  slots: AssistantSlots;
  confidence: number;
};

/** Below this, the answer is `unknown` whatever matched. */
export const UNKNOWN_FLOOR = 0.5;

/**
 * A state-changing intent needs more than a plausible match. Strictly above
 * UNKNOWN_FLOOR: the gap is the margin between "I think you meant this" and
 * "I am willing to write on it".
 */
export const MUTATING_FLOOR = 0.7;

const MUTATING = new Set<AssistantIntent>(["declare_waste", "retire_credit"]);

/* ---------- normalisation ---------- */

/** Devanagari, Gurmukhi and Gujarati digits -> ASCII. The thing that silently fails. */
const NATIVE_DIGITS = /[०-९੦-੯૦-૯]/g;
const DIGIT_BASES = [0x0966, 0x0a66, 0x0ae6];

const asciiDigits = (s: string): string =>
  s.replace(NATIVE_DIGITS, (ch) => {
    const cp = ch.codePointAt(0)!;
    const base = DIGIT_BASES.find((b) => cp >= b && cp <= b + 9);
    return base === undefined ? ch : String(cp - base);
  });

const normalise = (s: string): string => asciiDigits(s.normalize("NFC")).toLowerCase().replace(/\s+/g, " ").trim();

/* ---------- ids, by shape ---------- */

const LOT_ID = /\blot_[a-z0-9_.-]+/i;
const CREDIT_ID = /\bcrd_[a-z0-9_-]+/i;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;

/* ---------- tonnes ---------- */

/* Longest first: bare "t" would otherwise match the "t" of "tan" and then be
   rejected by the guard, losing the quantity entirely. "tan" is how it is said. */
const TONNE_UNIT = "tonnes?|tons?|tan|टन|ਟਨ|ટન|t";
/* The unit must not be the start of a longer word. Expressed as letter/mark
   properties rather than a codepoint range: a raw ऀ-෿ span reaches
   from Devanagari to Sinhala and pulls in combining marks with it. */
const NUMERIC_TONNES = new RegExp(String.raw`(\d+(?:\.\d+)?)\s*(?:${TONNE_UNIT})(?![\p{L}\p{M}])`, "u");

/** Spoken quantities. "saadhe teen tan" is how this is actually said. */
const WORD_NUM: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  ek: 1, do: 2, teen: 3, tin: 3, chaar: 4, char: 4, paanch: 5, panch: 5, chhe: 6, che: 6,
  saat: 7, aath: 8, nau: 9, das: 10,
};
/** A modifier that adds a half: "saadhe teen" is three and a half. */
const HALF_MORE = /^(saadhe|sadhe)$/;
/** Quantities that are a word on their own. */
const STANDALONE: Record<string, number> = { dedh: 1.5, derh: 1.5, dhai: 2.5, adhai: 2.5, sawa: 1.25 };

const WORD_TONNES = new RegExp(
  String.raw`(?:(saadhe|sadhe)\s+)?\b(${Object.keys(WORD_NUM).join("|")})\b\s*(?:${TONNE_UNIT})(?![a-z])`,
  "u",
);
const STANDALONE_TONNES = new RegExp(
  String.raw`\b(${Object.keys(STANDALONE).join("|")})\b\s*(?:${TONNE_UNIT})(?![a-z])`,
  "u",
);

/** The contract caps tonnes at 10 000 and requires positive. Anything else is not a tonnage. */
const plausibleTonnes = (n: number): number | undefined => (n > 0 && n <= 10_000 ? n : undefined);

const readTonnes = (text: string): number | undefined => {
  const numeric = NUMERIC_TONNES.exec(text);
  if (numeric) return plausibleTonnes(Number(numeric[1]));

  const word = WORD_TONNES.exec(text);
  if (word) {
    const base = WORD_NUM[word[2]!]!;
    return plausibleTonnes(HALF_MORE.test(word[1] ?? "") ? base + 0.5 : base);
  }

  const alone = STANDALONE_TONNES.exec(text);
  if (alone) return plausibleTonnes(STANDALONE[alone[1]!]!);

  return undefined;
};

/* ---------- feedstock ---------- *
 * The same words the field view already shows, plus how people actually say
 * them. Longest first: Gujarati "ઘઉંનું પરાળ" (wheat) contains "પરાળ", which
 * on its own means paddy straw. */

const FEEDSTOCK_WORDS: Array<[string, FeedstockClass]> = ([
  ["ਝੋਨੇ ਦੀ ਪਰਾਲੀ", "paddy_straw"],
  ["धान की पराली", "paddy_straw"],
  ["ડાંગરની પરાળ", "paddy_straw"],
  ["गेहूँ का भूसा", "wheat_straw"],
  ["गेहूं का भूसा", "wheat_straw"],
  ["ਕਣਕ ਦਾ ਨਾੜ", "wheat_straw"],
  ["ઘઉંનું પરાળ", "wheat_straw"],
  ["गन्ने की पत्ती", "sugarcane_trash"],
  ["ਗੰਨੇ ਦੀ ਪੱਤੀ", "sugarcane_trash"],
  ["શેરડીના પાન", "sugarcane_trash"],
  ["मक्के का डंठल", "maize_stover"],
  ["ਮੱਕੀ ਦਾ ਟਾਂਡਾ", "maize_stover"],
  ["મકાઈનો સાંઠો", "maize_stover"],
  ["मिला-जुला", "mixed"],
  ["ਰਲਿਆ-ਮਿਲਿਆ", "mixed"],
  ["paddy straw", "paddy_straw"],
  ["wheat straw", "wheat_straw"],
  ["corn stover", "maize_stover"],
  ["cane trash", "sugarcane_trash"],
  ["sugarcane", "sugarcane_trash"],
  ["ਪਰਾਲੀ", "paddy_straw"],
  ["पराली", "paddy_straw"],
  ["ડાંગર", "paddy_straw"],
  ["ਝੋਨਾ", "paddy_straw"],
  ["धान", "paddy_straw"],
  ["ਕਣਕ", "wheat_straw"],
  ["गेहूं", "wheat_straw"],
  ["ઘઉં", "wheat_straw"],
  ["भूसा", "wheat_straw"],
  ["ਗੰਨਾ", "sugarcane_trash"],
  ["गन्ना", "sugarcane_trash"],
  ["શેરડી", "sugarcane_trash"],
  ["ਮੱਕੀ", "maize_stover"],
  ["मक्का", "maize_stover"],
  ["મકાઈ", "maize_stover"],
  ["મિશ્ર", "mixed"],
  ["maize", "maize_stover"],
  ["paddy", "paddy_straw"],
  ["wheat", "wheat_straw"],
  ["mixed", "mixed"],
] as Array<[string, FeedstockClass]>).sort((a, b) => b[0].length - a[0].length);

const readFeedstock = (text: string): FeedstockClass | undefined =>
  FEEDSTOCK_WORDS.find(([word]) => text.includes(word.toLowerCase()))?.[1];

/* ---------- district ---------- *
 * The same names the producer assigns from a detection's coordinates. A
 * district we do not know is left unset rather than guessed. */

const DISTRICTS: Array<[string, string[]]> = [
  ["Ludhiana", ["लुधियाना", "ਲੁਧਿਆਣਾ", "લુધિયાણા"]],
  ["Amritsar", ["अमृतसर", "ਅੰਮ੍ਰਿਤਸਰ", "અમૃતસર"]],
  ["Tarn Taran", ["तरन तारन", "ਤਰਨ ਤਾਰਨ"]],
  ["Gurdaspur", []], ["Pathankot", []], ["Hoshiarpur", []],
  ["Jalandhar", ["जालंधर", "ਜਲੰਧਰ"]],
  ["Kapurthala", []], ["Nawanshahr", []],
  ["Moga", ["मोगा", "ਮੋਗਾ", "મોગા"]],
  ["Ferozepur", ["फिरोजपुर", "ਫ਼ਿਰੋਜ਼ਪੁਰ"]],
  ["Fazilka", []], ["Faridkot", []], ["Muktsar", []],
  ["Bathinda", ["बठिंडा", "ਬਠਿੰਡਾ"]],
  ["Mansa", []],
  ["Barnala", ["बरनाला", "ਬਰਨਾਲਾ"]],
  ["Sangrur", ["संगरूर", "ਸੰਗਰੂਰ"]],
  ["Patiala", ["पटियाला", "ਪਟਿਆਲਾ"]],
  ["Fatehgarh Sahib", []], ["Rupnagar", []], ["SAS Nagar", []],
  ["Chandigarh", ["चंडीगढ़", "ਚੰਡੀਗੜ੍ਹ"]],
  ["Ambala", []], ["Yamunanagar", []], ["Kurukshetra", []],
  ["Karnal", ["करनाल", "ਕਰਨਾਲ"]],
  ["Kaithal", ["कैथल", "ਕੈਥਲ"]],
  ["Jind", []], ["Fatehabad", []],
];

/** Longest surface form first, so "Tarn Taran" is not read as two districts. */
const DISTRICT_FORMS: Array<[string, string]> = DISTRICTS.flatMap(([name, aliases]) =>
  [name, ...aliases].map((form) => [form.toLowerCase(), name] as [string, string]),
).sort((a, b) => b[0].length - a[0].length);

const readDistrict = (text: string): string | undefined =>
  DISTRICT_FORMS.find(([form]) => text.includes(form))?.[1];

/* ---------- intent markers ---------- *
 * Weight is how much a phrase alone should be believed. Nothing here reaches
 * MUTATING_FLOOR without a slot to act on. */

type Candidate = { intent: AssistantIntent; score: number };

const has = (text: string, patterns: RegExp[]): boolean => patterns.some((p) => p.test(text));

const HOW_IT_WORKS = [
  /how (does|do) (this|it|charkha|the system)\b.*\bwork/,
  /how it works/,
  /कैसे काम करता/,
  /ਕਿਵੇਂ ਕੰਮ ਕਰਦਾ/,
  /કેવી રીતે કામ કરે/,
];
const RUN_MATCHING = [
  /\bmatch(ing|es)?\b/,
  /find (a|an|me a) (unit|buyer|facility)/,
  /मिलान/,
  /ਮਿਲਾਨ/,
  /મેચિંગ/,
];
const RETIRE = [/\bretire(d|ment)?\b/, /रिटायर/, /ਰਿਟਾਇਰ/, /રિટાયર/];
const STATUS_WORDS = [/\bstatus\b/, /\bstill (live|valid|active)\b/, /\bis it (live|valid)\b/, /स्थिति/, /ਹਾਲਤ/, /સ્થિતિ/];
const LOT_STATUS = [
  /what happened/,
  /क्या हुआ/,
  /ਕੀ ਹੋਇਆ/,
  /શું થયું/,
  /\bmy (waste|lots?|residue)\b/,
  /हमारे कचरे/,
  /ਸਾਡੇ ਕੂੜੇ/,
  /અમારા કચરા/,
];
const IMPACT = [
  /how much (co2|carbon|impact)/,
  /कितनी co2/,
  /ਕਿੰਨੀ co2/,
  /કેટલી co2/,
  /\b(total|overall) (co2|carbon|impact)\b/,
  /\bimpact\b/,
];
const DECLARE = [/\bdeclare\b/, /\bwe have\b/, /घोषित/, /ਸਾਡੇ ਕੋਲ/, /અમારી પાસે/];

const candidates = (text: string, slots: AssistantSlots): Candidate[] => {
  const out: Candidate[] = [];

  if (has(text, HOW_IT_WORKS)) out.push({ intent: "how_it_works", score: 0.9 });
  if (has(text, RUN_MATCHING)) out.push({ intent: "run_matching", score: 0.85 });
  if (has(text, IMPACT)) out.push({ intent: "impact_summary", score: 0.85 });

  /* A write needs its object. Without one this is not a low-scoring write,
     it is not a write at all - which is what keeps a coin flip off the ledger. */
  if (has(text, RETIRE) && slots.creditId) out.push({ intent: "retire_credit", score: 0.9 });

  if (slots.creditId && (has(text, STATUS_WORDS) || /\?|क्या|ਕੀ|શું/.test(text))) {
    out.push({ intent: "credit_status", score: 0.85 });
  }

  if (has(text, LOT_STATUS) || (slots.lotId && has(text, STATUS_WORDS))) {
    out.push({ intent: "lot_status", score: 0.85 });
  }

  /* Naming a quantity AND a feedstock is a declaration even with no verb -
     "3 tonnes of paddy straw in Ludhiana" is how someone actually says it.
     One without the other stays under the mutating floor on purpose. */
  if (slots.tonnes !== undefined && slots.feedstock) {
    out.push({ intent: "declare_waste", score: has(text, DECLARE) ? 0.95 : 0.9 });
  } else if (has(text, DECLARE) && (slots.tonnes !== undefined || slots.feedstock)) {
    out.push({ intent: "declare_waste", score: 0.6 });
  }

  return out;
};

/* ---------- resolve ---------- */

export const resolve = (utterance: string, _lang: AssistantLang): Resolution => {
  const text = normalise(utterance);
  const unknown = (slots: AssistantSlots = {}): Resolution => ({ intent: "unknown", slots, confidence: 0 });

  if (!text) return unknown();

  const slots: AssistantSlots = {};
  const lotId = LOT_ID.exec(utterance)?.[0];
  const creditId = CREDIT_ID.exec(utterance)?.[0];
  const taskId = UUID.exec(utterance)?.[0];
  if (lotId) slots.lotId = lotId;
  if (creditId) slots.creditId = creditId;
  if (taskId) slots.taskId = taskId;

  const tonnes = readTonnes(text);
  if (tonnes !== undefined) slots.tonnes = tonnes;
  const feedstock = readFeedstock(text);
  if (feedstock) slots.feedstock = feedstock;
  const district = readDistrict(text);
  if (district) slots.district = district;

  const best = candidates(text, slots).sort((a, b) => b.score - a.score)[0];
  if (!best) return unknown(slots);

  /* The two gates, in order. A mutating intent that did not clear its higher
     bar becomes `unknown` rather than a hedged write. */
  if (MUTATING.has(best.intent) && best.score < MUTATING_FLOOR) return unknown(slots);
  if (best.score < UNKNOWN_FLOOR) return unknown(slots);

  return { intent: best.intent, slots, confidence: best.score };
};
