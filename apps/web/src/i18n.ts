/* ------------------------------------------------------------------ *
 * Language.
 *
 * The problem statement names farms and facility operators as the users. In
 * Punjab and Haryana that is overwhelmingly Punjabi and Hindi speakers; in
 * Gujarat, where sugarcane and cotton residue burn too, it is Gujarati. The
 * Field view is the only screen those users actually touch - they are
 * standing in a field with a phone, photographing char.
 *
 * An English-only capture screen is not a localisation nicety we skipped; it
 * is the product not working for the people it is for.
 *
 * Deliberately dependency-free: a typed lookup, no i18n framework. We have
 * four languages and about forty strings. A library would be more code than
 * the thing it replaces.
 *
 * Operator and Audit stay English on purpose - their users are dispatchers,
 * auditors and buyers, and we would rather ship three languages properly on
 * the screen that needs them than six half-done everywhere.
 * ------------------------------------------------------------------ */

export const LANGUAGES = [
  { code: "en", label: "English", native: "English" },
  { code: "hi", label: "Hindi", native: "हिन्दी" },
  { code: "pa", label: "Punjabi", native: "ਪੰਜਾਬੀ" },
  { code: "gu", label: "Gujarati", native: "ગુજરાતી" },
] as const;

export type Lang = (typeof LANGUAGES)[number]["code"];

type Dict = Record<string, string>;

/* Keys are English sentences so an untranslated string still reads correctly
   rather than showing a dotted.key.path to a farmer. */
const HI: Dict = {
  "Field capture": "फ़ील्ड कैप्चर",
  "Inference runs on this device. The photo is never uploaded, only its hash and the scores.":
    "पहचान इसी फ़ोन पर होती है। फ़ोटो कभी अपलोड नहीं होती — सिर्फ़ उसका हैश और स्कोर भेजे जाते हैं।",
  "Take photo": "फ़ोटो लें",
  "Retake": "दोबारा लें",
  "Capture evidence": "सबूत दर्ज करें",
  "Submit": "भेजें",
  "Use device location": "फ़ोन की लोकेशन लें",
  "Location": "जगह",
  "Latitude": "अक्षांश",
  "Longitude": "देशांतर",
  "Match ID": "मैच आईडी",
  "Batch details": "बैच की जानकारी",
  "Peak temperature": "अधिकतम तापमान",
  "Residence time": "समय",
  "Feedstock": "कच्चा माल",
  "Output tonnes": "उत्पादन (टन)",
  "H/C ratio": "H/C अनुपात",
  "optional": "वैकल्पिक",
  "minutes": "मिनट",
  "tonnes": "टन",
  "Good char": "अच्छा चार",
  "Poor char": "कमज़ोर चार",
  "Not char": "चार नहीं",
  "Accepted": "स्वीकृत",
  "Rejected": "अस्वीकृत",
  "Needs review": "जाँच बाकी",
  "Offline": "ऑफ़लाइन",
  "Online": "ऑनलाइन",
  "Waiting to send": "भेजना बाकी",
  "Sent": "भेज दिया",
  "This is what leaves your phone": "आपके फ़ोन से सिर्फ़ इतना जाता है",
  "No photo is included.": "कोई फ़ोटो नहीं भेजी जाती।",
  "Result": "नतीजा",
  "Loading model": "मॉडल लोड हो रहा है",
  "Model ready": "मॉडल तैयार",
  "Lot says": "लॉट में दर्ज है",
  "Use the lot’s feedstock and send again": "लॉट वाला कच्चा माल चुनकर फिर भेजें",
  "paddy_straw": "धान की पराली",
  "wheat_straw": "गेहूँ का भूसा",
  "sugarcane_trash": "गन्ने की पत्ती",
  "maize_stover": "मक्के का डंठल",
  "mixed": "मिला-जुला",
};

const PA: Dict = {
  "Field capture": "ਫ਼ੀਲਡ ਕੈਪਚਰ",
  "Inference runs on this device. The photo is never uploaded, only its hash and the scores.":
    "ਪਛਾਣ ਇਸੇ ਫ਼ੋਨ ਉੱਤੇ ਹੁੰਦੀ ਹੈ। ਫ਼ੋਟੋ ਕਦੇ ਅਪਲੋਡ ਨਹੀਂ ਹੁੰਦੀ — ਸਿਰਫ਼ ਉਸਦਾ ਹੈਸ਼ ਅਤੇ ਸਕੋਰ ਭੇਜੇ ਜਾਂਦੇ ਹਨ।",
  "Take photo": "ਫ਼ੋਟੋ ਲਵੋ",
  "Retake": "ਦੁਬਾਰਾ ਲਵੋ",
  "Capture evidence": "ਸਬੂਤ ਦਰਜ ਕਰੋ",
  "Submit": "ਭੇਜੋ",
  "Use device location": "ਫ਼ੋਨ ਦੀ ਲੋਕੇਸ਼ਨ ਲਵੋ",
  "Location": "ਥਾਂ",
  "Latitude": "ਅਕਸ਼ਾਂਸ਼",
  "Longitude": "ਦੇਸ਼ਾਂਤਰ",
  "Match ID": "ਮੈਚ ਆਈਡੀ",
  "Batch details": "ਬੈਚ ਦੀ ਜਾਣਕਾਰੀ",
  "Peak temperature": "ਵੱਧ ਤੋਂ ਵੱਧ ਤਾਪਮਾਨ",
  "Residence time": "ਸਮਾਂ",
  "Feedstock": "ਕੱਚਾ ਮਾਲ",
  "Output tonnes": "ਪੈਦਾਵਾਰ (ਟਨ)",
  "H/C ratio": "H/C ਅਨੁਪਾਤ",
  "optional": "ਚੋਣਵਾਂ",
  "minutes": "ਮਿੰਟ",
  "tonnes": "ਟਨ",
  "Good char": "ਵਧੀਆ ਚਾਰ",
  "Poor char": "ਕਮਜ਼ੋਰ ਚਾਰ",
  "Not char": "ਚਾਰ ਨਹੀਂ",
  "Accepted": "ਮਨਜ਼ੂਰ",
  "Rejected": "ਨਾ-ਮਨਜ਼ੂਰ",
  "Needs review": "ਜਾਂਚ ਬਾਕੀ",
  "Offline": "ਆਫ਼ਲਾਈਨ",
  "Online": "ਆਨਲਾਈਨ",
  "Waiting to send": "ਭੇਜਣਾ ਬਾਕੀ",
  "Sent": "ਭੇਜ ਦਿੱਤਾ",
  "This is what leaves your phone": "ਤੁਹਾਡੇ ਫ਼ੋਨ ਤੋਂ ਸਿਰਫ਼ ਇੰਨਾ ਜਾਂਦਾ ਹੈ",
  "No photo is included.": "ਕੋਈ ਫ਼ੋਟੋ ਨਹੀਂ ਭੇਜੀ ਜਾਂਦੀ।",
  "Result": "ਨਤੀਜਾ",
  "Loading model": "ਮਾਡਲ ਲੋਡ ਹੋ ਰਿਹਾ ਹੈ",
  "Model ready": "ਮਾਡਲ ਤਿਆਰ",
  "Lot says": "ਲਾਟ ਵਿੱਚ ਦਰਜ ਹੈ",
  "Use the lot’s feedstock and send again": "ਲਾਟ ਵਾਲਾ ਕੱਚਾ ਮਾਲ ਚੁਣ ਕੇ ਦੁਬਾਰਾ ਭੇਜੋ",
  "paddy_straw": "ਝੋਨੇ ਦੀ ਪਰਾਲੀ",
  "wheat_straw": "ਕਣਕ ਦਾ ਨਾੜ",
  "sugarcane_trash": "ਗੰਨੇ ਦੀ ਪੱਤੀ",
  "maize_stover": "ਮੱਕੀ ਦਾ ਟਾਂਡਾ",
  "mixed": "ਰਲਿਆ-ਮਿਲਿਆ",
};

const GU: Dict = {
  "Field capture": "ફીલ્ડ કૅપ્ચર",
  "Inference runs on this device. The photo is never uploaded, only its hash and the scores.":
    "ઓળખ આ ફોન પર જ થાય છે. ફોટો ક્યારેય અપલોડ થતો નથી — ફક્ત તેનો હૅશ અને સ્કોર મોકલવામાં આવે છે.",
  "Take photo": "ફોટો લો",
  "Retake": "ફરીથી લો",
  "Capture evidence": "પુરાવો નોંધો",
  "Submit": "મોકલો",
  "Use device location": "ફોનનું લોકેશન લો",
  "Location": "જગ્યા",
  "Latitude": "અક્ષાંશ",
  "Longitude": "રેખાંશ",
  "Match ID": "મેચ આઈડી",
  "Batch details": "બૅચની વિગતો",
  "Peak temperature": "મહત્તમ તાપમાન",
  "Residence time": "સમય",
  "Feedstock": "કાચો માલ",
  "Output tonnes": "ઉત્પાદન (ટન)",
  "H/C ratio": "H/C ગુણોત્તર",
  optional: "વૈકલ્પિક",
  minutes: "મિનિટ",
  tonnes: "ટન",
  "Good char": "સારો ચાર",
  "Poor char": "નબળો ચાર",
  "Not char": "ચાર નથી",
  Accepted: "સ્વીકૃત",
  Rejected: "અસ્વીકૃત",
  "Needs review": "તપાસ બાકી",
  Offline: "ઑફલાઇન",
  Online: "ઑનલાઇન",
  "Waiting to send": "મોકલવાનું બાકી",
  Sent: "મોકલી દીધું",
  "This is what leaves your phone": "તમારા ફોનમાંથી ફક્ત આટલું જ જાય છે",
  "No photo is included.": "કોઈ ફોટો મોકલવામાં આવતો નથી.",
  Result: "પરિણામ",
  "Loading model": "મોડેલ લોડ થઈ રહ્યું છે",
  "Model ready": "મોડેલ તૈયાર",
  "Lot says": "લોટમાં નોંધ્યું છે",
  "Use the lot’s feedstock and send again": "લોટનો કાચો માલ પસંદ કરીને ફરી મોકલો",
  paddy_straw: "ડાંગરની પરાળ",
  wheat_straw: "ઘઉંનું પરાળ",
  sugarcane_trash: "શેરડીના પાન",
  maize_stover: "મકાઈનો સાંઠો",
  mixed: "મિશ્ર",
};

const DICTS: Record<Lang, Dict> = { en: {}, hi: HI, pa: PA, gu: GU };

const STORAGE_KEY = "charkha.lang";

/** Remembered choice, else the phone's language, else English. */
export const detectLang = (): Lang => {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && saved in DICTS) return saved as Lang;
  } catch {
    /* private mode - fall through to the browser's own setting */
  }
  const nav = typeof navigator === "undefined" ? "" : navigator.language.toLowerCase();
  if (nav.startsWith("pa")) return "pa";
  if (nav.startsWith("gu")) return "gu";
  if (nav.startsWith("hi")) return "hi";
  return "en";
};

export const rememberLang = (lang: Lang): void => {
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    /* nothing to do - the choice just will not survive a reload */
  }
};

/**
 * Translate. Falls back to the key, which is itself English, so a missing
 * translation degrades to a readable sentence rather than a broken token.
 */
export const translator =
  (lang: Lang) =>
  (key: string): string =>
    DICTS[lang][key] ?? key;

export type T = ReturnType<typeof translator>;
