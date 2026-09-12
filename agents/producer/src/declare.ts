import type { DeclareWasteInput, ResidueLot } from "@charkha/core";
import { sha256Hex } from "@charkha/core";

/* ------------------------------------------------------------------ *
 * OWNER: Harsh
 *
 * Declared waste, the pure half. No database, no clock, no id generator -
 * they are passed in. Same split as firms.ts: every decision that shapes a
 * lot lives somewhere a test can drive without Postgres, and the skill next
 * door is I/O only.
 *
 * WHY THIS PATH EXISTS AT ALL
 *
 * The producer's other source is the FIRMS fire feed, which by construction
 * finds waste that is BURNING. Two of the four users this project names never
 * burn anything: a municipality landfills its organic waste, a food factory
 * fills a skip. They are invisible to a thermal sensor, and they are the
 * pathway the problem statement leads with.
 *
 * WHY IT IS MARKED
 *
 * A detection is independent evidence - NASA saw the anomaly whether or not
 * anyone wanted it seen. A declaration is a claim by somebody who stands to
 * be paid for it. Both belong in the system; neither may wear the other's
 * clothes. Everything below exists to keep those two apart.
 * ------------------------------------------------------------------ */

/** Producer ids for declared lots all carry this, so the ledger reads honestly. */
export const DECLARED_PRODUCER_PREFIX = "decl";

/**
 * Who gets paid for a declared lot.
 *
 * `producerId` is not decoration: the registry reads it through
 * `findLotProducer` and writes it into the credential as `holder`, and only
 * the holder can retire that credit. So this has to name the declaring body,
 * and it has to be STABLE - the same ward declaring twice must accrue to one
 * identity, not two.
 *
 * Letters, digits AND combining marks are kept, in whatever script they
 * arrive in. Stripping to ASCII would collapse every Punjabi and Gujarati
 * declarer to the empty string on a product that ships in four languages, and
 * hand them all an opaque hash while English ones stayed readable.
 *
 * \p{M} is not decoration. Indic vowel signs are combining MARKS, not
 * letters: with letters and digits alone, "ਵਾਰਡ" (ward) came out as
 * "ਵ_ਰਡ" - the matras deleted and replaced by separators, turning a
 * declarer's name into something they would not recognise as theirs. Every
 * English test passed while it did that.
 *
 * The hash fallback is for the genuinely unslugable - a name that is entirely
 * punctuation. Stable, collision-free, and it never yields a bare prefix.
 */
export const declarerId = (declaredBy: string): string => {
  const slug = declaredBy
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60)
    .replace(/_+$/, "");
  return `${DECLARED_PRODUCER_PREFIX}_${slug || sha256Hex(declaredBy.trim()).slice(0, 12)}`;
};

/**
 * A declaration becomes a lot.
 *
 * `sourceDetectionId: null` and `origin: "declared"` are written here, in one
 * place, rather than at the call site - so there is exactly one line in the
 * codebase that could ever give a declared lot a satellite's credibility, and
 * it is this one. `DeclareWasteInput` cannot express a detection id at all,
 * so nothing can even be passed through by accident.
 *
 * `availableFrom` is normalised to an instant so the returned lot reads back
 * identical to the row that was stored - "2026-09-12T08:00:00Z" in, the
 * canonical form out, rather than two spellings of one moment.
 */
export const toDeclaredLot = (
  input: DeclareWasteInput,
  opts: { lotId: string; now: Date },
): ResidueLot => ({
  lotId: opts.lotId,
  producerId: declarerId(input.declaredBy),
  at: input.at,
  district: input.district,
  feedstock: input.feedstock,
  tonnes: input.tonnes,
  availableFrom: new Date(input.availableFrom ?? opts.now).toISOString(),
  sourceDetectionId: null,
  status: "listed",
  origin: "declared",
});
