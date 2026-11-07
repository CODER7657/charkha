import { z } from "zod";

/* ------------------------------------------------------------------ *
 * THE CONTRACTS.
 *
 * Every agent boundary in Charkha is one of these schemas. If you need a
 * new field, add it here FIRST, in its own PR, and tell the channel - do
 * not widen a type inside your own agent. This file is why nobody has to
 * wait for anybody.
 *
 * Rule: parse at the boundary, never trust an inbound payload. Every skill
 * handler already receives a parsed, validated input.
 * ------------------------------------------------------------------ */

/* ---------- shared primitives ---------- */

export const GeoPoint = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
});
export type GeoPoint = z.infer<typeof GeoPoint>;

export const FeedstockClass = z.enum(["paddy_straw", "wheat_straw", "sugarcane_trash", "maize_stover", "mixed"]);
export type FeedstockClass = z.infer<typeof FeedstockClass>;

/* ---------- PRODUCER  (owner: Harsh) ---------- */

/** One satellite fire detection, normalised from a FIRMS CSV row. */
export const BurnDetection = z.object({
  detectionId: z.string(),
  at: GeoPoint,
  acquiredAt: z.string().datetime(),
  satellite: z.string(),
  confidence: z.union([z.number(), z.string()]),
  frp: z.number().nullable(),
  district: z.string().nullable(),
});
export type BurnDetection = z.infer<typeof BurnDetection>;

/** A quantity of crop residue offered by a producer, ready to be collected. */
/**
 * How this lot entered the system, and it must never be inferred.
 *
 * A satellite detection is independent evidence: NASA saw a thermal anomaly
 * whether or not anyone wanted it seen. A declaration is a claim by somebody
 * who stands to be paid for it. Those carry different weight, and a carbon
 * system that blurs them is doing the thing carbon markets are criticised for.
 *
 * We need declarations regardless: FIRMS detects fire, so the statement's
 * headline pathway - organic waste going to landfill - is structurally
 * invisible to it. A municipality's food waste never burns. Declaration is how
 * municipalities and food-industry generators enter at all.
 *
 * So both paths exist and neither pretends to be the other. Declared lots are
 * marked on the map, in the ledger and on the credential.
 */
export const WasteOrigin = z.enum(["detected", "declared"]);
export type WasteOrigin = z.infer<typeof WasteOrigin>;

export const ResidueLot = z.object({
  lotId: z.string(),
  producerId: z.string(),
  at: GeoPoint,
  district: z.string().nullable(),
  feedstock: FeedstockClass,
  tonnes: z.number().positive(),
  availableFrom: z.string().datetime(),
  sourceDetectionId: z.string().nullable(),
  status: z.enum(["listed", "matched", "collected", "converted", "credited"]),
  /* Optional on purpose while the declare path is built separately: every lot
     that exists today is detected, and making this required would force a
     value into call sites that have nothing to say about it yet. The producer
     sets it explicitly on both paths; absent reads as detected. */
  origin: WasteOrigin.optional(),
});
export type ResidueLot = z.infer<typeof ResidueLot>;

export const ListLotsInput = z.object({
  district: z.string().optional(),
  status: ResidueLot.shape.status.optional(),
  limit: z.number().int().min(1).max(500).default(100),
});
export const ListLotsOutput = z.object({ lots: z.array(ResidueLot) });

export const IngestBurnsInput = z.object({
  bbox: z.string().optional(),
  /**
   * FIRMS caps the area API's DAY_RANGE at 5 - the docs say "1 .. 5" and the
   * request form offers nothing higher. This was max(10), a bound we invented:
   * a 7 would have passed our validation and then been refused upstream, which
   * turns a clear "invalid input" into a confusing feed error.
   */
  dayRange: z.number().int().min(1).max(5).optional(),
});
/**
 * Where an ingest actually got its CSV. The producer falls back
 * live -> newest cached response -> bundled sample, so a populated map is
 * NOT evidence that the live feed answered.
 */
export const FeedOrigin = z.enum(["live", "cache", "fixture"]);
export type FeedOrigin = z.infer<typeof FeedOrigin>;

export const IngestBurnsOutput = z.object({
  fetched: z.number().int(),
  newDetections: z.number().int(),
  lotsCreated: z.number().int(),
  origin: FeedOrigin,
  /**
   * The same sentence the agent reports through ctx.progress(), carried on the
   * output so the operator view can render it. Names the cached file when it
   * used one, so "cached response from 14:02" is visible rather than implied.
   */
  originNote: z.string(),
});

/* ---------- MATCHMAKER  (owner: Harsh) ---------- */

export const ConversionUnit = z.object({
  unitId: z.string(),
  name: z.string(),
  at: GeoPoint,
  capacityTonnesPerDay: z.number().positive(),
  accepts: z.array(FeedstockClass),
});
export type ConversionUnit = z.infer<typeof ConversionUnit>;

/**
 * Conversion units are already public on the operator map - a processing site,
 * its capacity and what feedstock it takes. Nothing here is sensitive, and the
 * browser cannot draw the unit layer or a lot -> unit route without it.
 */
export const ListUnitsInput = z.object({
  /** Only units that accept this feedstock. */
  feedstock: FeedstockClass.optional(),
  limit: z.number().int().min(1).max(500).default(200),
});
export const ListUnitsOutput = z.object({ units: z.array(ConversionUnit) });

export const Match = z.object({
  matchId: z.string(),
  lotId: z.string(),
  unitId: z.string(),
  distanceKm: z.number().nonnegative(),
  transportKgCo2e: z.number().nonnegative(),
  assignedTonnes: z.number().positive(),
  decidedAt: z.string().datetime(),
  rationale: z.string(),
});
export type Match = z.infer<typeof Match>;

/**
 * The matches a field worker could be standing in front of.
 *
 * Field capture asks for a matchId and, until this existed, offered no way on
 * earth to obtain one: the input was free text with a `match_...` placeholder,
 * and the only place a real id appeared was the Operator screen's result panel
 * - which shows nothing once a round has used the day's capacity. A farmer
 * with a phone and a char pile had no route to the id the form demands.
 *
 * `awaitingEvidence` is the default because that is the actual question being
 * asked: which batch have I not yet photographed.
 */
export const ListMatchesInput = z.object({
  /** Only matches with no evidence submitted yet. */
  awaitingEvidence: z.boolean().default(true),
  limit: z.number().int().min(1).max(200).default(25),
});
/** A match plus the human words needed to recognise it without knowing its id. */
export const MatchSummary = Match.extend({
  unitName: z.string(),
  district: z.string().nullable(),
  feedstock: FeedstockClass,
  hasEvidence: z.boolean(),
});
export type MatchSummary = z.infer<typeof MatchSummary>;
export const ListMatchesOutput = z.object({ matches: z.array(MatchSummary) });

export const RunMatchingInput = z.object({
  district: z.string().optional(),
  maxRadiusKm: z.number().positive().default(60),
});
export const RunMatchingOutput = z.object({
  matches: z.array(Match),
  unmatchedLotIds: z.array(z.string()),
});

/* ---------- VERIFIER  (owner: Hem) ---------- */

/**
 * Evidence submitted from the field view.
 * NOTE: `imageHash` only. The photo itself never leaves the device - the
 * classifier runs in the browser via onnxruntime-web. If you ever find
 * yourself adding a base64 image field here, stop and ask in the channel.
 */
export const FieldEvidence = z.object({
  evidenceId: z.string(),
  matchId: z.string(),
  at: GeoPoint,
  capturedAt: z.string().datetime(),
  imageHash: z.string().length(64),
  modelHash: z.string().length(64),
  modelVersion: z.string(),
  clientScores: z.record(z.string(), z.number()),
  batch: z.object({
    pyrolysisPeakTempC: z.number(),
    residenceTimeMin: z.number(),
    feedstock: FeedstockClass,
    outputTonnes: z.number().positive(),
    hcOrgRatio: z.number().nullable(),
  }),
});
export type FieldEvidence = z.infer<typeof FieldEvidence>;

export const VerifyEvidenceInput = FieldEvidence;
export const VerifyEvidenceOutput = z.object({
  evidenceId: z.string(),
  verdict: z.enum(["accepted", "rejected", "needs_review"]),
  charQualityScore: z.number().min(0).max(1),
  predictedClass: z.string(),
  confidence: z.number().min(0).max(1),
  modelHash: z.string(),
  modelVersion: z.string(),
  reasons: z.array(z.string()),
  methodologyChecks: z.array(
    z.object({ check: z.string(), passed: z.boolean(), detail: z.string() }),
  ),
});
export type VerifyEvidenceOutput = z.infer<typeof VerifyEvidenceOutput>;

/* ---------- REGISTRY  (owner: Ayush) ---------- */

export const CreditRecord = z.object({
  creditId: z.string(),
  matchId: z.string(),
  evidenceId: z.string(),
  netTonnesCo2e: z.number(),
  breakdown: z.object({
    grossSequestrationTco2e: z.number(),
    transportDebitTco2e: z.number(),
    processDebitTco2e: z.number(),
  }),
  issuedAt: z.string().datetime(),
  status: z.enum(["issued", "retired", "revoked"]),
  credentialJwt: z.string(),
  credentialId: z.string(),
  issuerDid: z.string(),
  /**
   * Who holds this credit - the producer of the lot it came from.
   *
   * Retirement is terminal, irreversible and globally visible through the
   * status list, and credit ids are not secret: `GET /api/ledger` and
   * `GET /api/trace/:taskId` are unauthenticated, so two requests enumerate
   * every credit in the system. Without an owner, anyone could retire all of
   * them.
   *
   * This is a FIELD CHECK, not proven identity. It stops trivial
   * enumerate-and-retire and nothing more. Production needs a signed holder
   * presentation - say that plainly rather than implying otherwise.
   */
  holder: z.string().min(1),
  /**
   * Bit position this credential commits to in the published status list.
   *
   * Allocated atomically from a database sequence BEFORE signing. Deriving it
   * from a row count lets two concurrent issuances embed the same index, and
   * then retiring one credit sets the bit the other points at - leaving a
   * retired credit verifying as live, under our own signature.
   */
  statusListIndex: z.number().int().nonnegative(),
});
export type CreditRecord = z.infer<typeof CreditRecord>;

/**
 * Deliberately does NOT carry the verdict.
 *
 * The registry reads it from the `verifications` row the verifier wrote. A
 * caller-supplied verdict let anyone who could reach the gateway mint a
 * credential for a batch the verifier never saw, at the maximum quality
 * multiplier (#16, closed in #18).
 *
 * Keeping the field also forced every caller to echo the stored row byte for
 * byte, so any transport that touched encoding broke issuance.
 */
export const IssueCreditInput = z.object({
  matchId: z.string(),
  evidenceId: z.string(),
});
export const IssueCreditOutput = z.object({ credit: CreditRecord });

export const RetireCreditInput = z.object({
  creditId: z.string(),
  /** Must equal the credit's `holder`, or retirement is refused. */
  retiredBy: z.string().min(1),
  reason: z.string().default("voluntary retirement"),
});
export const RetireCreditOutput = z.object({ credit: CreditRecord });

/**
 * Read one credit by its id.
 *
 * The registry could issue and retire, but nothing could answer "is credit X
 * still live, what is it worth, what backs it". A holder has the credit id -
 * `/api/trace/:taskId` is keyed by task id, and the status list answers "is
 * bit N set", not "is this credit retired". Saathi is the first surface where
 * that gap is visible, but it is not Saathi's gap.
 */
export const LookupCreditInput = z.object({ creditId: z.string() });
/**
 * A missing credit is an ANSWER, not a fault.
 *
 * Throwing would surface through the gateway's caller-error classifier as the
 * registry's own English prose, which on a Punjabi screen stays English -
 * exactly the failure the assistant's message keys exist to avoid. Returning
 * null lets the caller say "no such credit" in the reader's language.
 */
export const LookupCreditOutput = z.object({ credit: CreditRecord.nullable() });

/* ---------- DECISION LOG (shared, append-only) ---------- */

export const DecisionRecord = z.object({
  seq: z.number().int().nonnegative(),
  taskId: z.string(),
  agent: z.enum(["producer", "matchmaker", "verifier", "registry"]),
  agentCardId: z.string(),
  action: z.string(),
  inputHash: z.string().length(64),
  outputHash: z.string().length(64),
  modelHash: z.string().nullable(),
  confidence: z.number().nullable(),
  at: z.string().datetime(),
  prevHash: z.string(),
  hash: z.string().length(64),
});
export type DecisionRecord = z.infer<typeof DecisionRecord>;

/** The one thing a judge follows end to end. Gateway serves this by task id. */
export const TraceBundle = z.object({
  taskId: z.string(),
  lot: ResidueLot.nullable(),
  match: Match.nullable(),
  evidence: FieldEvidence.nullable(),
  verification: VerifyEvidenceOutput.nullable(),
  credit: CreditRecord.nullable(),
  chain: z.array(DecisionRecord),
  chainValid: z.boolean(),
});
export type TraceBundle = z.infer<typeof TraceBundle>;

/* ------------------------------------------------------------------ *
 * Declared waste - the second supply path.
 *
 * The producer's only source today is the FIRMS fire feed, which by
 * construction finds waste that is BURNING. Two of the four users this
 * project is written for never burn anything: a municipality landfills its
 * organic waste, and a food factory fills a skip. They cannot enter a system
 * whose front door is a thermal anomaly.
 *
 * A declaration is weaker evidence than a detection and is recorded as such -
 * see WasteOrigin. It is not a lesser lot; it is an honestly labelled one.
 * ------------------------------------------------------------------ */

export const DeclareWasteInput = z.object({
  /** Who says so. A panchayat, a municipal ward, a factory. */
  declaredBy: z.string().min(1).max(120),
  feedstock: FeedstockClass,
  tonnes: z.number().positive().max(10_000),
  at: GeoPoint,
  district: z.string().min(1).max(120).nullable(),
  /** When it is ready for collection. Defaults to now at the agent. */
  availableFrom: z.string().datetime().optional(),
  /** Free text from the declarer, kept verbatim for the ledger. */
  note: z.string().max(280).optional(),
});
export type DeclareWasteInput = z.infer<typeof DeclareWasteInput>;

export const DeclareWasteOutput = z.object({ lot: ResidueLot });
export type DeclareWasteOutput = z.infer<typeof DeclareWasteOutput>;

/* ------------------------------------------------------------------ *
 * Saathi - the assistant agent a human talks to.
 *
 * It owns no business logic. It resolves what was asked, plans which of the
 * existing skills answer it, calls them over A2A like any other agent, and
 * reports the hops it made. Every guard those skills already enforce still
 * applies, because it is the same code path.
 * ------------------------------------------------------------------ */

export const AssistantLang = z.enum(["en", "hi", "pa", "gu"]);
export type AssistantLang = z.infer<typeof AssistantLang>;

/** Closed set on purpose. An assistant that can attempt anything can be talked into anything. */
export const AssistantIntent = z.enum([
  "lot_status",
  "declare_waste",
  "run_matching",
  "credit_status",
  "retire_credit",
  "impact_summary",
  "how_it_works",
  "unknown",
]);
export type AssistantIntent = z.infer<typeof AssistantIntent>;

/** Everything the resolver can pull out of an utterance. All optional; the planner decides what it needs. */
export const AssistantSlots = z.object({
  district: z.string().max(120).optional(),
  feedstock: FeedstockClass.optional(),
  tonnes: z.number().positive().max(10_000).optional(),
  lotId: z.string().max(160).optional(),
  creditId: z.string().max(160).optional(),
  taskId: z.string().max(160).optional(),
  holder: z.string().max(120).optional(),
  declaredBy: z.string().max(120).optional(),
  radiusKm: z.number().positive().max(500).optional(),
});
export type AssistantSlots = z.infer<typeof AssistantSlots>;

export const AssistantAskInput = z.object({
  utterance: z.string().min(1).max(500),
  lang: AssistantLang.default("en"),
  /**
   * Who is asking.
   *
   * Retiring a credit needs a holder and declaring waste needs a declarer, and
   * neither can be read out of a sentence. Not because it is hard - "retire
   * crd_x as prod_sangrur" parses fine - but because a sentence is the wrong
   * place to assert an identity. If the resolver lifts a holder out of prose,
   * anyone can retire anyone's credit by typing the right name into it, and
   * the holder check that guards retirement becomes decorative.
   *
   * Be clear about what this does and does not buy. We have no user
   * authentication, so this is still an unvalidated claim - a field instead of
   * a phrase. What it buys is one deliberate place for that claim, clearly
   * labelled, which is where a signed holder presentation would attach when
   * there is one. The Provenance screen already says retirement authorisation
   * is partial for exactly this reason, and it stays partial.
   */
  identity: z.string().min(1).max(120).optional(),
  /**
   * Echoed back from a previous answer's `confirmation.token` to actually
   * perform a write. An intent that mutates NEVER executes on the first ask -
   * the assistant says what it is about to do and waits. This is the whole
   * safety model for letting a sentence run a skill.
   */
  confirm: z.string().max(200).optional(),
});
export type AssistantAskInput = z.infer<typeof AssistantAskInput>;

/** One real A2A call the assistant made. Returned so the UI can show the mesh working. */
export const AgentHop = z.object({
  agent: z.string(),
  skill: z.string(),
  taskId: z.string().nullable(),
  ms: z.number().nonnegative(),
  ok: z.boolean(),
});
export type AgentHop = z.infer<typeof AgentHop>;

/**
 * A key and its parameters, never a finished sentence.
 *
 * The verifier returns English prose in `reasons`, and on a Punjabi screen
 * that prose stays English because `t()` cannot reach inside it. We are not
 * repeating that here: the assistant returns what to say, the client decides
 * in which language to say it.
 */
export const AssistantMessage = z.object({
  key: z.string().min(1),
  params: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
});
export type AssistantMessage = z.infer<typeof AssistantMessage>;

export const AssistantAnswerOutput = z.object({
  intent: AssistantIntent,
  slots: AssistantSlots,
  /** 0..1. Below the resolver's threshold the intent is `unknown` and nothing is planned. */
  confidence: z.number().min(0).max(1),
  reply: AssistantMessage,
  /** Present only when the intent would write, and nothing has happened yet. */
  confirmation: z
    .object({ token: z.string().min(1), summary: AssistantMessage })
    .nullable()
    .default(null),
  /** Set once a confirmed write actually ran. */
  performed: z.boolean().default(false),
  hops: z.array(AgentHop).default([]),
  /** Whatever the planned skills returned, for the UI to render. Shape varies by intent. */
  data: z.unknown().nullable().default(null),
});
export type AssistantAnswerOutput = z.infer<typeof AssistantAnswerOutput>;
