import type { FeedstockClass, VerifyEvidenceOutput } from "@charkha/core";

/**
 * OWNER: Hem
 *
 * Recovering from a feedstock mismatch.
 *
 * The operator picks a feedstock from a dropdown with no way to know what the
 * lot says, and only finds out after a photo and a full inference run, from a
 * verdict that names the failed check. On stage that is a dead end.
 *
 * The verdict already carries the answer: `feedstock_matches_lot` reports
 * "batch paddy_straw, lot mixed". So we read the lot's value out of it, show
 * it beside the dropdown, and offer to resend with it - keeping the photo and
 * its scores, so nobody has to walk back to the char and shoot it again.
 *
 * The proper fix is preselecting from the match before the first submit, but
 * nothing exposes matchId -> lot today (the gateway serves lots and units, not
 * matches). Remembering what the lot said gets the same result from the second
 * attempt on, without a contract change.
 */

export const FEEDSTOCKS: FeedstockClass[] = [
  "paddy_straw",
  "wheat_straw",
  "sugarcane_trash",
  "maize_stover",
  "mixed",
];

const isFeedstock = (v: string): v is FeedstockClass => (FEEDSTOCKS as string[]).includes(v);

/** The lot's feedstock, read from a failed feedstock_matches_lot check. Null when it passed or is absent. */
export const lotFeedstockFromVerdict = (out: VerifyEvidenceOutput): FeedstockClass | null => {
  const check = out.methodologyChecks.find((c) => c.check === "feedstock_matches_lot");
  if (!check || check.passed) return null;
  const lot = /lot\s+([a-z_]+)/.exec(check.detail)?.[1];
  return lot && isFeedstock(lot) ? lot : null;
};

/**
 * One photograph, one submission.
 *
 * The verifier stores one evidence row per image hash and refuses a second
 * evidence id carrying a photo it has already seen, as a double-count attempt
 * (#46). That refusal is a 400, which the offline queue treats as final - so
 * resending the same bytes is not a retry that eventually lands, it is
 * evidence dropped and an honest operator accused of claiming twice.
 *
 * Checking it here turns that into a plain sentence and saves the round trip.
 */
export const photoAlreadySent = (sentImageHash: string | null, imageHash: string): boolean =>
  sentImageHash !== null && sentImageHash === imageHash;

type KV = Pick<Storage, "getItem" | "setItem">;

const key = (matchId: string) => `charkha.field.lotFeedstock.${matchId}`;

/** Remember what a match's lot said, so the next capture starts from the right value. */
export const rememberLotFeedstock = (store: KV, matchId: string, feedstock: FeedstockClass): void => {
  if (!matchId.trim()) return;
  try {
    store.setItem(key(matchId.trim()), feedstock);
  } catch {
    /* private mode - the hint just will not survive a reload */
  }
};

export const recallLotFeedstock = (store: KV, matchId: string): FeedstockClass | null => {
  if (!matchId.trim()) return null;
  try {
    const v = store.getItem(key(matchId.trim()));
    return v && isFeedstock(v) ? v : null;
  } catch {
    return null;
  }
};
