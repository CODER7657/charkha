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
export const fill = (template: Template, params: AssistantMessage["params"], lang: Lang = "en"): string =>
  template.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const value = params[name];
    if (value === undefined) return whole;
    return renderValue(value, lang);
  });

/**
 * A parameter is not always a number or a name.
 *
 * Two kinds arrive as raw machine values and used to land untranslated inside
 * a translated sentence - "crd_x ਹੁਣ retired ਹੈ", "जारी 2026-09-12T08:37:20.938Z".
 * The frame was Punjabi and the word inside it was not, which is the same
 * failure as prose in a parameter, one level down: `t()` reaches the template
 * and stops.
 *
 * So: a value that names a key is rendered as that key, and an ISO timestamp
 * is rendered as a date in the reader's locale. Everything else is unchanged.
 */
const ISO = /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/;

const renderValue = (value: string | number | boolean, lang: Lang): string => {
  if (typeof value !== "string") return String(value);

  if (value.startsWith("assistant.")) {
    const dict = DICTS[lang] ?? EN;
    return dict[value] ?? EN[value] ?? value;
  }

  if (ISO.test(value)) {
    const at = new Date(value);
    if (!Number.isNaN(at.getTime())) {
      return new Intl.DateTimeFormat(LOCALE[lang], { dateStyle: "medium" }).format(at);
    }
  }

  return value;
};

/** BCP-47 tags for the four languages the app offers. */
const LOCALE: Record<Lang, string> = { en: "en-IN", hi: "hi-IN", pa: "pa-IN", gu: "gu-IN" };

const EN: Dict = {
  /* Values, not sentences. A status or a reason that arrives as a raw enum
     reads as an English word inside a translated sentence. */
  "assistant.status.issued": "live",
  "assistant.status.retired": "retired",
  "assistant.status.revoked": "revoked",
  "assistant.reason.unreachable_list": "the list cannot be reached from here",
  "assistant.reason.origin_unknown": "we cannot tell where the list should be",
  "assistant.reason.no_status_entry": "the credential names no list",
  "assistant.reason.no_credential": "there is no credential to check",

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
  "assistant.credit.need_id":
    "Which credit? Give me its id, like crd_1234abcd.",
  "assistant.credit.malformed_id":
    "{creditId} is not a credit id we would have issued. They look like crd_ followed by letters and digits.",
  "assistant.credit.not_found":
    "I could not find a credit with the id {creditId}.",
  "assistant.credit.status":
    "{creditId} is {status}, worth {tonnes} tCO2e, held by {holder}. Issued {issuedAt}.",
  "assistant.credit.status_not_verifiable":
    "{creditId} is {status}, worth {tonnes} tCO2e, held by {holder} (issued {issuedAt}) - but I cannot check whether it has been retired. It points at {listHost} for that, which cannot be reached from here ({reason}). The signature on the credit is fine; it is the revocation list that is unreachable.",
  "assistant.credit.retire_need_id":
    "Which credit should I retire? Give me its id.",
  "assistant.credit.retire_need_holder":
    "Before I retire {creditId} I need to know who you are - only the holder can retire a credit.",
  "assistant.credit.retire_summary":
    "Retire {creditId} as {retiredBy}? This is permanent - a retired credit cannot be brought back or resold.",
  "assistant.credit.retired":
    "{creditId} is retired, as {retiredBy}.",
  "assistant.credit.retired_detail":
    "{creditId} is now {status} - {tonnes} tCO2e, held by {holder}. The published list will show it as revoked.",
  "assistant.declare.need_feedstock":
    "What kind of waste is it? Paddy straw, wheat straw, sugarcane trash, maize stover, or mixed.",
  "assistant.declare.need_tonnes":
    "Roughly how many tonnes?",
  "assistant.declare.need_place":
    "Which district or village is it in?",
  "assistant.declare.need_declared_by":
    "And who is declaring it? A ward, a panchayat or a company name - it is recorded, and only they can claim the credit.",
  "assistant.declare.unknown_district":
    "I do not cover {district} yet, so I cannot record waste there. We work across the Punjab and Haryana belt.",
  "assistant.declare.confirm":
    "Record {tonnes} t of {feedstock} in {district}, declared by {declaredBy}? It will be marked as declared, not detected by satellite.",
  "assistant.declare.done":
    "Recorded: {tonnes} t of {feedstock} in {district}, as {lotId}. It is now listed for collection.",
};

const HI: Dict = {
  "assistant.status.issued": "चालू",
  "assistant.status.retired": "रिटायर",
  "assistant.status.revoked": "रद्द",
  "assistant.reason.unreachable_list": "वह सूची यहाँ से खुल नहीं रही",
  "assistant.reason.origin_unknown": "हमें पता नहीं कि सूची कहाँ होनी चाहिए",
  "assistant.reason.no_status_entry": "क्रेडेंशियल में कोई सूची दर्ज नहीं है",
  "assistant.reason.no_credential": "जाँचने के लिए कोई क्रेडेंशियल ही नहीं है",

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
  "assistant.credit.need_id":
    "कौन-सा क्रेडिट? उसकी आईडी बताइए, जैसे crd_1234abcd।",
  "assistant.credit.malformed_id":
    "{creditId} हमारे जारी किए क्रेडिट की आईडी नहीं लगती। वे crd_ से शुरू होती हैं।",
  "assistant.credit.not_found":
    "{creditId} आईडी वाला कोई क्रेडिट नहीं मिला।",
  "assistant.credit.status":
    "{creditId} अभी {status} है, {tonnes} tCO2e का, धारक {holder}। जारी {issuedAt}।",
  "assistant.credit.status_not_verifiable":
    "{creditId} {status} है, {tonnes} tCO2e, धारक {holder} (जारी {issuedAt}) - पर यह जाँचा नहीं जा सकता कि वह रिटायर हुआ या नहीं। वह इसके लिए {listHost} बताता है, जो यहाँ से पहुँच में नहीं ({reason})। क्रेडिट का हस्ताक्षर ठीक है; सूची तक पहुँच नहीं है।",
  "assistant.credit.retire_need_id":
    "कौन-सा क्रेडिट रिटायर करूँ? उसकी आईडी बताइए।",
  "assistant.credit.retire_need_holder":
    "{creditId} रिटायर करने से पहले जानना होगा कि आप कौन हैं - केवल धारक ही रिटायर कर सकता है।",
  "assistant.credit.retire_summary":
    "{creditId} को {retiredBy} के रूप में रिटायर करें? यह स्थायी है - रिटायर क्रेडिट वापस नहीं आता।",
  "assistant.credit.retired":
    "{creditId} रिटायर हो गया, {retiredBy} के रूप में।",
  "assistant.credit.retired_detail":
    "{creditId} अब {status} है - {tonnes} tCO2e, धारक {holder}। प्रकाशित सूची में यह रद्द दिखेगा।",
  "assistant.declare.need_feedstock":
    "किस तरह का कचरा है? धान की पराली, गेहूँ का भूसा, गन्ने की पत्ती, मक्के का डंठल, या मिला-जुला।",
  "assistant.declare.need_tonnes":
    "लगभग कितने टन?",
  "assistant.declare.need_place":
    "यह किस ज़िले या गाँव में है?",
  "assistant.declare.need_declared_by":
    "और यह कौन दर्ज कर रहा है? वार्ड, पंचायत या कंपनी का नाम - यह दर्ज होता है, और क्रेडिट उन्हीं का होगा।",
  "assistant.declare.unknown_district":
    "{district} अभी हमारे क्षेत्र में नहीं है, इसलिए वहाँ कचरा दर्ज नहीं कर सकता। हम पंजाब-हरियाणा पट्टी में काम करते हैं।",
  "assistant.declare.confirm":
    "{district} में {tonnes} टन {feedstock} दर्ज करें, {declaredBy} द्वारा घोषित? यह घोषित के रूप में दर्ज होगा, सैटेलाइट से पाया हुआ नहीं।",
  "assistant.declare.done":
    "दर्ज हुआ: {district} में {tonnes} टन {feedstock}, {lotId} के रूप में। अब यह संग्रह के लिए सूचीबद्ध है।",
};

const PA: Dict = {
  "assistant.status.issued": "ਚਾਲੂ",
  "assistant.status.retired": "ਰਿਟਾਇਰ",
  "assistant.status.revoked": "ਰੱਦ",
  "assistant.reason.unreachable_list": "ਉਹ ਸੂਚੀ ਇੱਥੋਂ ਖੁੱਲ੍ਹ ਨਹੀਂ ਰਹੀ",
  "assistant.reason.origin_unknown": "ਸਾਨੂੰ ਪਤਾ ਨਹੀਂ ਕਿ ਸੂਚੀ ਕਿੱਥੇ ਹੋਣੀ ਚਾਹੀਦੀ ਹੈ",
  "assistant.reason.no_status_entry": "ਕ੍ਰੈਡੈਂਸ਼ੀਅਲ ਵਿੱਚ ਕੋਈ ਸੂਚੀ ਦਰਜ ਨਹੀਂ",
  "assistant.reason.no_credential": "ਜਾਂਚਣ ਲਈ ਕੋਈ ਕ੍ਰੈਡੈਂਸ਼ੀਅਲ ਹੀ ਨਹੀਂ",

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
  "assistant.credit.need_id":
    "ਕਿਹੜਾ ਕ੍ਰੈਡਿਟ? ਉਸ ਦੀ ਆਈਡੀ ਦੱਸੋ, ਜਿਵੇਂ crd_1234abcd।",
  "assistant.credit.malformed_id":
    "{creditId} ਸਾਡੇ ਜਾਰੀ ਕੀਤੇ ਕ੍ਰੈਡਿਟ ਦੀ ਆਈਡੀ ਨਹੀਂ ਲੱਗਦੀ। ਉਹ crd_ ਨਾਲ ਸ਼ੁਰੂ ਹੁੰਦੀਆਂ ਹਨ।",
  "assistant.credit.not_found":
    "{creditId} ਆਈਡੀ ਵਾਲਾ ਕੋਈ ਕ੍ਰੈਡਿਟ ਨਹੀਂ ਮਿਲਿਆ।",
  "assistant.credit.status":
    "{creditId} ਹੁਣ {status} ਹੈ, {tonnes} tCO2e ਦਾ, ਧਾਰਕ {holder}। ਜਾਰੀ {issuedAt}।",
  "assistant.credit.status_not_verifiable":
    "{creditId} {status} ਹੈ, {tonnes} tCO2e, ਧਾਰਕ {holder} (ਜਾਰੀ {issuedAt}) - ਪਰ ਇਹ ਜਾਂਚਿਆ ਨਹੀਂ ਜਾ ਸਕਦਾ ਕਿ ਉਹ ਰਿਟਾਇਰ ਹੋਇਆ ਜਾਂ ਨਹੀਂ। ਉਹ ਇਸ ਲਈ {listHost} ਦੱਸਦਾ ਹੈ, ਜੋ ਇੱਥੋਂ ਪਹੁੰਚ ਵਿੱਚ ਨਹੀਂ ({reason})। ਕ੍ਰੈਡਿਟ ਦਾ ਦਸਤਖਤ ਠੀਕ ਹੈ; ਸੂਚੀ ਤੱਕ ਪਹੁੰਚ ਨਹੀਂ।",
  "assistant.credit.retire_need_id":
    "ਕਿਹੜਾ ਕ੍ਰੈਡਿਟ ਰਿਟਾਇਰ ਕਰਾਂ? ਉਸ ਦੀ ਆਈਡੀ ਦੱਸੋ।",
  "assistant.credit.retire_need_holder":
    "{creditId} ਰਿਟਾਇਰ ਕਰਨ ਤੋਂ ਪਹਿਲਾਂ ਜਾਣਨਾ ਪਵੇਗਾ ਕਿ ਤੁਸੀਂ ਕੌਣ ਹੋ - ਸਿਰਫ਼ ਧਾਰਕ ਹੀ ਰਿਟਾਇਰ ਕਰ ਸਕਦਾ ਹੈ।",
  "assistant.credit.retire_summary":
    "{creditId} ਨੂੰ {retiredBy} ਵਜੋਂ ਰਿਟਾਇਰ ਕਰਾਂ? ਇਹ ਪੱਕਾ ਹੈ - ਰਿਟਾਇਰ ਕ੍ਰੈਡਿਟ ਵਾਪਸ ਨਹੀਂ ਆਉਂਦਾ।",
  "assistant.credit.retired":
    "{creditId} ਰਿਟਾਇਰ ਹੋ ਗਿਆ, {retiredBy} ਵਜੋਂ।",
  "assistant.credit.retired_detail":
    "{creditId} ਹੁਣ {status} ਹੈ - {tonnes} tCO2e, ਧਾਰਕ {holder}। ਪ੍ਰਕਾਸ਼ਿਤ ਸੂਚੀ ਵਿੱਚ ਇਹ ਰੱਦ ਦਿਖੇਗਾ।",
  "assistant.declare.need_feedstock":
    "ਕਿਸ ਤਰ੍ਹਾਂ ਦਾ ਕੂੜਾ ਹੈ? ਝੋਨੇ ਦੀ ਪਰਾਲੀ, ਕਣਕ ਦਾ ਨਾੜ, ਗੰਨੇ ਦੀ ਪੱਤੀ, ਮੱਕੀ ਦਾ ਡੰਡਾ, ਜਾਂ ਰਲਿਆ-ਮਿਲਿਆ।",
  "assistant.declare.need_tonnes":
    "ਲਗਭਗ ਕਿੰਨੇ ਟਨ?",
  "assistant.declare.need_place":
    "ਇਹ ਕਿਹੜੇ ਜ਼ਿਲ੍ਹੇ ਜਾਂ ਪਿੰਡ ਵਿੱਚ ਹੈ?",
  "assistant.declare.need_declared_by":
    "ਅਤੇ ਇਹ ਕੌਣ ਦਰਜ ਕਰ ਰਿਹਾ ਹੈ? ਵਾਰਡ, ਪੰਚਾਇਤ ਜਾਂ ਕੰਪਨੀ ਦਾ ਨਾਂ - ਇਹ ਦਰਜ ਹੁੰਦਾ ਹੈ, ਅਤੇ ਕ੍ਰੈਡਿਟ ਉਹਨਾਂ ਦਾ ਹੀ ਹੋਵੇਗਾ।",
  "assistant.declare.unknown_district":
    "{district} ਹਾਲੇ ਸਾਡੇ ਖੇਤਰ ਵਿੱਚ ਨਹੀਂ ਹੈ, ਇਸ ਲਈ ਉੱਥੇ ਕੂੜਾ ਦਰਜ ਨਹੀਂ ਕਰ ਸਕਦਾ। ਅਸੀਂ ਪੰਜਾਬ-ਹਰਿਆਣਾ ਪੱਟੀ ਵਿੱਚ ਕੰਮ ਕਰਦੇ ਹਾਂ।",
  "assistant.declare.confirm":
    "{district} ਵਿੱਚ {tonnes} ਟਨ {feedstock} ਦਰਜ ਕਰਾਂ, {declaredBy} ਵੱਲੋਂ ਘੋਸ਼ਿਤ? ਇਹ ਘੋਸ਼ਿਤ ਵਜੋਂ ਦਰਜ ਹੋਵੇਗਾ, ਸੈਟੇਲਾਈਟ ਤੋਂ ਮਿਲਿਆ ਨਹੀਂ।",
  "assistant.declare.done":
    "ਦਰਜ ਹੋ ਗਿਆ: {district} ਵਿੱਚ {tonnes} ਟਨ {feedstock}, {lotId} ਵਜੋਂ। ਹੁਣ ਇਹ ਇਕੱਠ ਲਈ ਸੂਚੀਬੱਧ ਹੈ।",
};

const GU: Dict = {
  "assistant.status.issued": "ચાલુ",
  "assistant.status.retired": "રિટાયર",
  "assistant.status.revoked": "રદ",
  "assistant.reason.unreachable_list": "તે યાદી અહીંથી ખૂલતી નથી",
  "assistant.reason.origin_unknown": "અમને ખબર નથી કે યાદી ક્યાં હોવી જોઈએ",
  "assistant.reason.no_status_entry": "ક્રેડેન્શિયલમાં કોઈ યાદી નોંધાયેલ નથી",
  "assistant.reason.no_credential": "તપાસવા માટે કોઈ ક્રેડેન્શિયલ જ નથી",

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
  "assistant.credit.need_id":
    "કયું ક્રેડિટ? તેની આઈડી આપો, જેમ કે crd_1234abcd.",
  "assistant.credit.malformed_id":
    "{creditId} અમે આપેલા ક્રેડિટની આઈડી નથી લાગતી. તે crd_ થી શરૂ થાય છે.",
  "assistant.credit.not_found":
    "{creditId} આઈડી વાળું કોઈ ક્રેડિટ મળ્યું નહીં.",
  "assistant.credit.status":
    "{creditId} અત્યારે {status} છે, {tonnes} tCO2e નું, ધારક {holder}. જારી {issuedAt}.",
  "assistant.credit.status_not_verifiable":
    "{creditId} {status} છે, {tonnes} tCO2e, ધારક {holder} (જારી {issuedAt}) - પણ તે રિટાયર થયું કે નહીં તે તપાસી શકાતું નથી. તે માટે તે {listHost} બતાવે છે, જે અહીંથી પહોંચમાં નથી ({reason}). ક્રેડિટની સહી બરાબર છે; યાદી સુધી પહોંચ નથી.",
  "assistant.credit.retire_need_id":
    "કયું ક્રેડિટ રિટાયર કરું? તેની આઈડી આપો.",
  "assistant.credit.retire_need_holder":
    "{creditId} રિટાયર કરતાં પહેલાં જાણવું પડશે કે તમે કોણ છો - ફક્ત ધારક જ રિટાયર કરી શકે.",
  "assistant.credit.retire_summary":
    "{creditId} ને {retiredBy} તરીકે રિટાયર કરું? આ કાયમી છે - રિટાયર ક્રેડિટ પાછું આવતું નથી.",
  "assistant.credit.retired":
    "{creditId} રિટાયર થઈ ગયું, {retiredBy} તરીકે.",
  "assistant.credit.retired_detail":
    "{creditId} હવે {status} છે - {tonnes} tCO2e, ધારક {holder}. પ્રકાશિત યાદીમાં તે રદ દેખાશે.",
  "assistant.declare.need_feedstock":
    "કયા પ્રકારનો કચરો છે? ડાંગરની પરાળ, ઘઉંનું પરાળ, શેરડીના પાન, મકાઈનો ડાંખળો, કે મિશ્ર.",
  "assistant.declare.need_tonnes":
    "આશરે કેટલા ટન?",
  "assistant.declare.need_place":
    "તે કયા જિલ્લા કે ગામમાં છે?",
  "assistant.declare.need_declared_by":
    "અને આ કોણ નોંધાવે છે? વોર્ડ, પંચાયત કે કંપનીનું નામ - તે નોંધાય છે, અને ક્રેડિટ તેમનું જ થશે.",
  "assistant.declare.unknown_district":
    "{district} હજુ અમારા વિસ્તારમાં નથી, તેથી ત્યાં કચરો નોંધી શકતો નથી. અમે પંજાબ-હરિયાણા પટ્ટીમાં કામ કરીએ છીએ.",
  "assistant.declare.confirm":
    "{district} માં {tonnes} ટન {feedstock} નોંધું, {declaredBy} દ્વારા જાહેર? તે જાહેર તરીકે નોંધાશે, સેટેલાઇટથી મળેલું નહીં.",
  "assistant.declare.done":
    "નોંધાયું: {district} માં {tonnes} ટન {feedstock}, {lotId} તરીકે. હવે તે સંગ્રહ માટે યાદીમાં છે.",
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
  fill(DICTS[lang][m.key] ?? EN[m.key] ?? m.key, m.params, lang);
