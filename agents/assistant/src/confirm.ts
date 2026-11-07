import { createHmac, timingSafeEqual } from "node:crypto";
import { canonicalJson } from "@charkha/core";
import type { AssistantIntent, AssistantSlots } from "@charkha/core";

/* ------------------------------------------------------------------ *
 * OWNER: core
 *
 * The token that lets a sentence perform a write.
 *
 * `retire_credit` is irreversible and `declare_waste` appends to the ledger.
 * Both are one sentence away from being triggered by accident, or by someone
 * who half-meant it. So the assistant proposes, issues a token, and waits.
 *
 * The token is bound to the EXACT intent and slots it was issued for. That is
 * the property that matters, and it is not obvious: without it a user could be
 * shown "retire crd_A - 1.05 tCO2e?" and then have that agreement spent on
 * crd_B, either by a bug reordering state or by someone replaying a token
 * against a different request. Signing the proposal rather than issuing an
 * opaque ticket makes the two impossible to separate.
 *
 * Stateless on purpose: nothing to store, nothing to clean up, and no way for
 * a restart to strand a half-agreed action. The signature IS the record.
 * ------------------------------------------------------------------ */

/** Long enough to read a sentence and answer, short enough that a stale tab cannot act. */
export const CONFIRM_TTL_MS = 5 * 60_000;

const secret = (): string => {
  const s = process.env["A2A_JWT_SECRET"];
  // Never fall back to a default. A default is a signing key that reaches a VPS.
  if (!s) throw new Error("A2A_JWT_SECRET is not set - cannot sign a confirmation");
  return s;
};

/** What the signature commits to. Canonical so key order cannot change the digest. */
const body = (intent: AssistantIntent, slots: AssistantSlots, expiresAt: number): string =>
  canonicalJson({ intent, slots, expiresAt });

const sign = (payload: string): string =>
  createHmac("sha256", secret()).update(payload).digest("base64url");

export const mintConfirmation = (
  intent: AssistantIntent,
  slots: AssistantSlots,
  now: number = Date.now(),
): string => {
  const expiresAt = now + CONFIRM_TTL_MS;
  return `${expiresAt}.${sign(body(intent, slots, expiresAt))}`;
};

export type ConfirmCheck =
  | { ok: true }
  | { ok: false; reason: "malformed" | "expired" | "mismatch" };

/**
 * Does this token authorise exactly this action?
 *
 * Returns a reason rather than a boolean because the three failures mean
 * different things to a person: a stale tab, a tampered request, and a request
 * for something other than what they agreed to.
 */
export const checkConfirmation = (
  token: string,
  intent: AssistantIntent,
  slots: AssistantSlots,
  now: number = Date.now(),
): ConfirmCheck => {
  const dot = token.indexOf(".");
  if (dot < 1) return { ok: false, reason: "malformed" };

  const expiresAt = Number(token.slice(0, dot));
  const given = token.slice(dot + 1);
  if (!Number.isSafeInteger(expiresAt) || given.length === 0) return { ok: false, reason: "malformed" };

  /* Compare the signature BEFORE reporting expiry. An unsigned token that has
     also expired is a forgery attempt, not a slow user, and telling the two
     apart in the response hands an attacker a clock oracle. */
  const expected = sign(body(intent, slots, expiresAt));
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, reason: "mismatch" };

  if (now > expiresAt) return { ok: false, reason: "expired" };
  return { ok: true };
};
