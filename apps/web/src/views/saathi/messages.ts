import type { AssistantMessage } from "@charkha/core";
import type { Lang } from "../../i18n.ts";

/* ------------------------------------------------------------------ *
 * OWNER: core
 *
 * Rendering what the assistant said, in the language the person is reading.
 *
 * The assistant returns `{ key, params }` and never a finished sentence. That
 * is a direct consequence of a real defect: the verifier returns English prose
 * in `reasons`, so on a fully Punjabi field screen - heading, verdict, buttons
 * and guidance all in Gurmukhi - the actual reason for refusal is English,
 * because `t()` cannot reach inside a sentence the server already built.
 *
 * So the server says WHAT to say and the client decides HOW. Which also means
 * a missing translation degrades into a readable English sentence rather than
 * a raw key: the fallback is the English template, not `assistant.lots.none`.
 * ------------------------------------------------------------------ */

type Template = string;
type Dict = Record<string, Template>;

/**
 * `{name}` is replaced by `params.name`. Deliberately not a format library:
 * these are forty short strings and a dependency would be more code than the
 * thing it replaces - the same call we made for i18n itself.
 */
export const fill = (template: Template, params: AssistantMessage["params"]): string =>
  template.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const value = params[name];
    return value === undefined ? whole : String(value);
  });

const EN: Dict = {
  "assistant.not_understood":
    "I did not understand that. You can ask what happened to your waste, how much CO₂ your district has sequestered, or ask me to run matching.",
  "assistant.refused": "{agent} would not do that, so nothing was changed.",
  "assistant.refused.retire_credit":
    "That credit was not retired, and nothing was changed. Most often that is because someone else holds it — ask me for the credit's status and I will tell you who.",
  "assistant.unavailable": "I could not reach {agent} just now. Nothing was changed.",

  "assistant.confirm.mismatch":
    "That confirmation was for a different request, so I have not done anything. Please ask again.",
  "assistant.confirm.expired": "That confirmation expired. Here it is again — confirm if you still want it.",
  "assistant.confirm.malformed": "I could not read that confirmation. Here it is again.",

  "assistant.lots.need_district": "Which district or village should I look up?",
  "assistant.lots.none": "I found no waste recorded for {district}.",
  "assistant.lots.summary":
    "{district}: {total} lots, {tonnes} t in total — {listed} still waiting, {matched} sent to a unit, {credited} already credited. {declared} of these were declared by someone rather than detected by satellite.",

  "assistant.impact.need_district": "Which district should I calculate for?",
  "assistant.impact.none": "I found no waste recorded for {district}, so there is nothing to calculate.",
  "assistant.impact.summary":
    "{district}: {tonnes} t of waste across {lots} lots. At best that is about {potentialTco2e} tCO₂e if all of it is converted — an upper limit, not a promise. {creditedLots} lots have actually been credited, worth about {creditedTco2e} tCO₂e. Factors: {yieldFactor} t biochar per t feedstock, {factor} tCO₂e per t biochar.",

  "assistant.matching.confirm":
    "Shall I run a matching round at {radiusKm} km? This writes one permanent record to the ledger, even if nothing matches.",
  "assistant.matching.done":
    "Done — {matched} lots matched, {unplaced} could not be placed within {radiusKm} km.",
  "assistant.matching.none":
    "Nothing matched. All {unplaced} lots are further than {radiusKm} km from a unit that accepts them. That is the catchment limit, not a failure — try a wider radius.",
};

const HI: Dict = {
  "assistant.not_understood":
    "मैं समझ नहीं पाया। आप पूछ सकते हैं कि आपके कूड़े का क्या हुआ, आपके ज़िले ने कितनी CO₂ रोकी, या मुझसे मैचिंग चलाने को कह सकते हैं।",
  "assistant.refused": "{agent} ने यह करने से मना कर दिया, इसलिए कुछ भी नहीं बदला।",
  "assistant.refused.retire_credit":
    "वह क्रेडिट रिटायर नहीं हुआ, कुछ भी नहीं बदला। अक्सर इसकी वजह यह होती है कि वह किसी और के नाम है — मुझसे उसकी स्थिति पूछें, मैं बता दूँगा कि वह किसके पास है।",
  "assistant.unavailable": "{agent} से अभी संपर्क नहीं हो सका। कुछ भी नहीं बदला गया।",

  "assistant.confirm.mismatch": "वह पुष्टि किसी और अनुरोध के लिए थी, इसलिए मैंने कुछ नहीं किया। कृपया दोबारा पूछें।",
  "assistant.confirm.expired": "वह पुष्टि समाप्त हो गई। यह रही दोबारा — अब भी चाहें तो पुष्टि करें।",
  "assistant.confirm.malformed": "मैं वह पुष्टि पढ़ नहीं सका। यह रही दोबारा।",

  "assistant.lots.need_district": "किस ज़िले या गाँव की जानकारी देखूँ?",
  "assistant.lots.none": "{district} के लिए कोई कूड़ा दर्ज नहीं मिला।",
  "assistant.lots.summary":
    "{district}: {total} लॉट, कुल {tonnes} टन — {listed} अभी बाकी, {matched} यूनिट को भेजे गए, {credited} का क्रेडिट बन चुका। इनमें से {declared} किसी ने खुद दर्ज किए थे, सैटेलाइट से नहीं मिले।",

  "assistant.impact.need_district": "किस ज़िले के लिए हिसाब लगाऊँ?",
  "assistant.impact.none": "{district} के लिए कोई कूड़ा दर्ज नहीं है, तो हिसाब लगाने को कुछ नहीं।",
  "assistant.impact.summary":
    "{district}: {lots} लॉट में {tonnes} टन कूड़ा। सब बदला जाए तो ज़्यादा से ज़्यादा लगभग {potentialTco2e} tCO₂e — यह ऊपरी सीमा है, वादा नहीं। {creditedLots} लॉट का क्रेडिट बन चुका है, लगभग {creditedTco2e} tCO₂e। गुणक: {yieldFactor} टन बायोचार प्रति टन कूड़ा, {factor} tCO₂e प्रति टन बायोचार।",

  "assistant.matching.confirm":
    "क्या {radiusKm} किमी पर मैचिंग चलाऊँ? इससे लेजर में एक स्थायी रिकॉर्ड लिखा जाएगा, चाहे कुछ मैच हो या न हो।",
  "assistant.matching.done": "हो गया — {matched} लॉट मैच हुए, {unplaced} को {radiusKm} किमी में जगह नहीं मिली।",
  "assistant.matching.none":
    "कुछ मैच नहीं हुआ। सभी {unplaced} लॉट उन्हें स्वीकार करने वाली यूनिट से {radiusKm} किमी से दूर हैं। यह दायरे की सीमा है, खराबी नहीं — बड़ा दायरा आज़माएँ।",
};

const PA: Dict = {
  "assistant.not_understood":
    "ਮੈਂ ਸਮਝ ਨਹੀਂ ਸਕਿਆ। ਤੁਸੀਂ ਪੁੱਛ ਸਕਦੇ ਹੋ ਕਿ ਤੁਹਾਡੇ ਕੂੜੇ ਦਾ ਕੀ ਹੋਇਆ, ਤੁਹਾਡੇ ਜ਼ਿਲ੍ਹੇ ਨੇ ਕਿੰਨੀ CO₂ ਰੋਕੀ, ਜਾਂ ਮੈਨੂੰ ਮੈਚਿੰਗ ਚਲਾਉਣ ਲਈ ਕਹਿ ਸਕਦੇ ਹੋ।",
  "assistant.refused": "{agent} ਨੇ ਇਹ ਕਰਨ ਤੋਂ ਇਨਕਾਰ ਕੀਤਾ, ਇਸ ਲਈ ਕੁਝ ਵੀ ਨਹੀਂ ਬਦਲਿਆ।",
  "assistant.refused.retire_credit":
    "ਉਹ ਕ੍ਰੈਡਿਟ ਰਿਟਾਇਰ ਨਹੀਂ ਹੋਇਆ, ਕੁਝ ਵੀ ਨਹੀਂ ਬਦਲਿਆ। ਆਮ ਤੌਰ ਤੇ ਇਸ ਦਾ ਕਾਰਨ ਇਹ ਹੁੰਦਾ ਹੈ ਕਿ ਉਹ ਕਿਸੇ ਹੋਰ ਦੇ ਨਾਂ ਹੈ — ਮੈਨੂੰ ਉਸ ਦੀ ਸਥਿਤੀ ਪੁੱਛੋ, ਮੈਂ ਦੱਸਾਂਗਾ ਕਿ ਉਹ ਕਿਸ ਕੋਲ ਹੈ।",
  "assistant.unavailable": "{agent} ਨਾਲ ਹੁਣੇ ਸੰਪਰਕ ਨਹੀਂ ਹੋ ਸਕਿਆ। ਕੁਝ ਵੀ ਨਹੀਂ ਬਦਲਿਆ।",

  "assistant.confirm.mismatch": "ਉਹ ਪੁਸ਼ਟੀ ਕਿਸੇ ਹੋਰ ਬੇਨਤੀ ਲਈ ਸੀ, ਇਸ ਲਈ ਮੈਂ ਕੁਝ ਨਹੀਂ ਕੀਤਾ। ਕਿਰਪਾ ਕਰਕੇ ਦੁਬਾਰਾ ਪੁੱਛੋ।",
  "assistant.confirm.expired": "ਉਹ ਪੁਸ਼ਟੀ ਖਤਮ ਹੋ ਗਈ। ਇਹ ਦੁਬਾਰਾ ਹੈ — ਜੇ ਹੁਣ ਵੀ ਚਾਹੁੰਦੇ ਹੋ ਤਾਂ ਪੁਸ਼ਟੀ ਕਰੋ।",
  "assistant.confirm.malformed": "ਮੈਂ ਉਹ ਪੁਸ਼ਟੀ ਪੜ੍ਹ ਨਹੀਂ ਸਕਿਆ। ਇਹ ਦੁਬਾਰਾ ਹੈ।",

  "assistant.lots.need_district": "ਕਿਹੜੇ ਜ਼ਿਲ੍ਹੇ ਜਾਂ ਪਿੰਡ ਦੀ ਜਾਣਕਾਰੀ ਵੇਖਾਂ?",
  "assistant.lots.none": "{district} ਲਈ ਕੋਈ ਕੂੜਾ ਦਰਜ ਨਹੀਂ ਮਿਲਿਆ।",
  "assistant.lots.summary":
    "{district}: {total} ਲਾਟ, ਕੁੱਲ {tonnes} ਟਨ — {listed} ਹਾਲੇ ਬਾਕੀ, {matched} ਯੂਨਿਟ ਨੂੰ ਭੇਜੇ, {credited} ਦਾ ਕ੍ਰੈਡਿਟ ਬਣ ਚੁੱਕਾ। ਇਹਨਾਂ ਵਿੱਚੋਂ {declared} ਕਿਸੇ ਨੇ ਆਪ ਦਰਜ ਕੀਤੇ ਸਨ, ਸੈਟੇਲਾਈਟ ਤੋਂ ਨਹੀਂ ਮਿਲੇ।",

  "assistant.impact.need_district": "ਕਿਹੜੇ ਜ਼ਿਲ੍ਹੇ ਲਈ ਹਿਸਾਬ ਲਾਵਾਂ?",
  "assistant.impact.none": "{district} ਲਈ ਕੋਈ ਕੂੜਾ ਦਰਜ ਨਹੀਂ ਹੈ, ਸੋ ਹਿਸਾਬ ਲਾਉਣ ਨੂੰ ਕੁਝ ਨਹੀਂ।",
  "assistant.impact.summary":
    "{district}: {lots} ਲਾਟਾਂ ਵਿੱਚ {tonnes} ਟਨ ਕੂੜਾ। ਸਭ ਬਦਲਿਆ ਜਾਵੇ ਤਾਂ ਵੱਧ ਤੋਂ ਵੱਧ ਲਗਭਗ {potentialTco2e} tCO₂e — ਇਹ ਉਪਰਲੀ ਹੱਦ ਹੈ, ਵਾਅਦਾ ਨਹੀਂ। {creditedLots} ਲਾਟਾਂ ਦਾ ਕ੍ਰੈਡਿਟ ਬਣ ਚੁੱਕਾ ਹੈ, ਲਗਭਗ {creditedTco2e} tCO₂e। ਗੁਣਕ: {yieldFactor} ਟਨ ਬਾਇਓਚਾਰ ਪ੍ਰਤੀ ਟਨ ਕੂੜਾ, {factor} tCO₂e ਪ੍ਰਤੀ ਟਨ ਬਾਇਓਚਾਰ।",

  "assistant.matching.confirm":
    "ਕੀ {radiusKm} ਕਿਲੋਮੀਟਰ ਉੱਤੇ ਮੈਚਿੰਗ ਚਲਾਵਾਂ? ਇਸ ਨਾਲ ਲੈਜਰ ਵਿੱਚ ਇੱਕ ਪੱਕਾ ਰਿਕਾਰਡ ਲਿਖਿਆ ਜਾਵੇਗਾ, ਭਾਵੇਂ ਕੁਝ ਮੈਚ ਹੋਵੇ ਜਾਂ ਨਾ।",
  "assistant.matching.done": "ਹੋ ਗਿਆ — {matched} ਲਾਟਾਂ ਮੈਚ ਹੋਈਆਂ, {unplaced} ਨੂੰ {radiusKm} ਕਿਲੋਮੀਟਰ ਵਿੱਚ ਥਾਂ ਨਹੀਂ ਮਿਲੀ।",
  "assistant.matching.none":
    "ਕੁਝ ਮੈਚ ਨਹੀਂ ਹੋਇਆ। ਸਾਰੀਆਂ {unplaced} ਲਾਟਾਂ ਉਹਨਾਂ ਨੂੰ ਸਵੀਕਾਰ ਕਰਨ ਵਾਲੀ ਯੂਨਿਟ ਤੋਂ {radiusKm} ਕਿਲੋਮੀਟਰ ਤੋਂ ਦੂਰ ਹਨ। ਇਹ ਦਾਇਰੇ ਦੀ ਹੱਦ ਹੈ, ਖਰਾਬੀ ਨਹੀਂ — ਵੱਡਾ ਦਾਇਰਾ ਅਜ਼ਮਾਓ।",
};

const GU: Dict = {
  "assistant.not_understood":
    "હું સમજી શક્યો નહીં. તમે પૂછી શકો છો કે તમારા કચરાનું શું થયું, તમારા જિલ્લાએ કેટલી CO₂ રોકી, અથવા મને મેચિંગ ચલાવવાનું કહી શકો છો.",
  "assistant.refused": "{agent} એ તે કરવાની ના પાડી, તેથી કશું બદલાયું નથી.",
  "assistant.refused.retire_credit":
    "તે ક્રેડિટ રિટાયર થઈ નથી, કશું બદલાયું નથી. સામાન્ય રીતે તેનું કારણ એ હોય છે કે તે કોઈ બીજાના નામે છે — મને તેની સ્થિતિ પૂછો, હું કહીશ કે તે કોની પાસે છે.",
  "assistant.unavailable": "{agent} સાથે અત્યારે સંપર્ક થઈ શક્યો નહીં. કશું બદલાયું નથી.",

  "assistant.confirm.mismatch": "એ પુષ્ટિ બીજી વિનંતી માટે હતી, તેથી મેં કશું કર્યું નથી. કૃપા કરી ફરી પૂછો.",
  "assistant.confirm.expired": "એ પુષ્ટિ સમાપ્ત થઈ ગઈ. આ ફરી રહી — હજુ પણ જોઈતું હોય તો પુષ્ટિ કરો.",
  "assistant.confirm.malformed": "હું એ પુષ્ટિ વાંચી શક્યો નહીં. આ ફરી રહી.",

  "assistant.lots.need_district": "કયા જિલ્લા કે ગામની માહિતી જોઉં?",
  "assistant.lots.none": "{district} માટે કોઈ કચરો નોંધાયેલો મળ્યો નહીં.",
  "assistant.lots.summary":
    "{district}: {total} લોટ, કુલ {tonnes} ટન — {listed} હજુ બાકી, {matched} યુનિટને મોકલ્યા, {credited} ને ક્રેડિટ મળી ગઈ. તેમાંથી {declared} કોઈએ જાતે નોંધ્યા હતા, સેટેલાઇટથી મળ્યા નથી.",

  "assistant.impact.need_district": "કયા જિલ્લા માટે ગણતરી કરું?",
  "assistant.impact.none": "{district} માટે કોઈ કચરો નોંધાયેલો નથી, તેથી ગણવા જેવું કશું નથી.",
  "assistant.impact.summary":
    "{district}: {lots} લોટમાં {tonnes} ટન કચરો. બધું રૂપાંતરિત થાય તો વધુમાં વધુ આશરે {potentialTco2e} tCO₂e — આ ઉપરની મર્યાદા છે, વચન નહીં. {creditedLots} લોટને ક્રેડિટ મળી ચૂકી છે, આશરે {creditedTco2e} tCO₂e. ગુણક: {yieldFactor} ટન બાયોચાર પ્રતિ ટન કચરો, {factor} tCO₂e પ્રતિ ટન બાયોચાર.",

  "assistant.matching.confirm":
    "શું {radiusKm} કિમી પર મેચિંગ ચલાવું? આનાથી લેજરમાં એક કાયમી રેકોર્ડ લખાશે, ભલે કશું મેચ થાય કે ન થાય.",
  "assistant.matching.done": "થઈ ગયું — {matched} લોટ મેચ થયા, {unplaced} ને {radiusKm} કિમીમાં જગ્યા મળી નહીં.",
  "assistant.matching.none":
    "કશું મેચ થયું નહીં. બધા {unplaced} લોટ તેમને સ્વીકારતી યુનિટથી {radiusKm} કિમીથી દૂર છે. આ વિસ્તારની મર્યાદા છે, ખામી નહીં — મોટો વિસ્તાર અજમાવો.",
};

const DICTS: Record<Lang, Dict> = { en: EN, hi: HI, pa: PA, gu: GU };

/** Every key the assistant can return. Used by the test that keeps the four dictionaries honest. */
export const KEYS = Object.keys(EN);

/**
 * Render one assistant message.
 *
 * A missing translation falls back to the ENGLISH TEMPLATE, not to the raw
 * key. Someone reading Punjabi who hits a gap gets a usable English sentence
 * with their numbers in it, rather than `assistant.lots.summary`.
 */
export const renderMessage = (m: AssistantMessage, lang: Lang): string =>
  fill(DICTS[lang][m.key] ?? EN[m.key] ?? m.key, m.params);
