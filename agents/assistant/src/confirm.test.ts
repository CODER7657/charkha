import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { AssistantSlots } from "@charkha/core";
import { CONFIRM_TTL_MS, checkConfirmation, mintConfirmation } from "./confirm.ts";

/* ------------------------------------------------------------------ *
 * The token is the entire safety model for letting a sentence act.
 *
 * The property that matters is not "a token exists" - it is that the token is
 * bound to the exact action it was shown for. Without that, an agreement to
 * retire crd_A can be spent on crd_B, and the confirmation step becomes
 * theatre that makes the system feel safer than it is.
 * ------------------------------------------------------------------ */

const SLOTS: AssistantSlots = { creditId: "crd_a", holder: "prod_bathinda" };

describe("confirmation tokens", () => {
  beforeEach(() => {
    process.env["A2A_JWT_SECRET"] = "test-secret-for-confirmations";
  });
  afterEach(() => {
    delete process.env["A2A_JWT_SECRET"];
  });

  it("accepts a token for exactly the action it was minted for", () => {
    const token = mintConfirmation("retire_credit", SLOTS);
    expect(checkConfirmation(token, "retire_credit", SLOTS)).toEqual({ ok: true });
  });

  /* THE ONE THIS FILE EXISTS FOR. Agreeing to retire one credit must not
     authorise retiring another. */
  it("refuses a token spent on a different credit", () => {
    const token = mintConfirmation("retire_credit", SLOTS);
    expect(checkConfirmation(token, "retire_credit", { ...SLOTS, creditId: "crd_b" })).toEqual({
      ok: false,
      reason: "mismatch",
    });
  });

  it("refuses a token spent on a different intent", () => {
    const token = mintConfirmation("retire_credit", SLOTS);
    expect(checkConfirmation(token, "declare_waste", SLOTS)).toEqual({
      ok: false,
      reason: "mismatch",
    });
  });

  it("refuses a token spent as a different holder", () => {
    const token = mintConfirmation("retire_credit", SLOTS);
    expect(checkConfirmation(token, "retire_credit", { ...SLOTS, holder: "someone_else" })).toEqual({
      ok: false,
      reason: "mismatch",
    });
  });

  /* Slots are canonicalised before signing, so the same action written in a
     different key order is the same action - not a mismatch a user would have
     to re-confirm for no reason they could see. */
  it("is indifferent to the order the slots were built in", () => {
    const token = mintConfirmation("retire_credit", { creditId: "crd_a", holder: "prod_bathinda" });
    expect(
      checkConfirmation(token, "retire_credit", { holder: "prod_bathinda", creditId: "crd_a" }),
    ).toEqual({ ok: true });
  });

  it("refuses a token signed with a different secret", () => {
    const token = mintConfirmation("retire_credit", SLOTS);
    process.env["A2A_JWT_SECRET"] = "a-different-secret";
    expect(checkConfirmation(token, "retire_credit", SLOTS)).toEqual({
      ok: false,
      reason: "mismatch",
    });
  });

  it("refuses a token whose expiry was edited after signing", () => {
    const token = mintConfirmation("retire_credit", SLOTS);
    const forged = `${Number(token.split(".")[0]) + 600_000}.${token.split(".")[1]}`;
    expect(checkConfirmation(forged, "retire_credit", SLOTS)).toEqual({
      ok: false,
      reason: "mismatch",
    });
  });

  it("refuses an expired token", () => {
    const past = Date.now() - CONFIRM_TTL_MS - 1;
    const token = mintConfirmation("retire_credit", SLOTS, past);
    expect(checkConfirmation(token, "retire_credit", SLOTS)).toEqual({
      ok: false,
      reason: "expired",
    });
  });

  it("still accepts a token a moment before it expires", () => {
    const now = Date.now();
    const token = mintConfirmation("retire_credit", SLOTS, now);
    expect(checkConfirmation(token, "retire_credit", SLOTS, now + CONFIRM_TTL_MS - 1)).toEqual({
      ok: true,
    });
  });

  it("refuses malformed tokens rather than throwing", () => {
    for (const bad of ["", ".", "abc", ".sig", "notanumber.sig", "12345."]) {
      expect(checkConfirmation(bad, "retire_credit", SLOTS).ok, JSON.stringify(bad)).toBe(false);
    }
  });

  /* An unsigned token that has also expired is a forgery attempt, not a slow
     user. Reporting expiry first would tell an attacker their signature was
     the problem only once they fixed the clock - a free oracle. */
  it("reports a bad signature as mismatch even when the token is also expired", () => {
    const past = Date.now() - CONFIRM_TTL_MS - 1;
    const token = mintConfirmation("retire_credit", SLOTS, past);
    expect(checkConfirmation(token, "retire_credit", { creditId: "crd_b" })).toEqual({
      ok: false,
      reason: "mismatch",
    });
  });

  it("will not sign without a secret", () => {
    delete process.env["A2A_JWT_SECRET"];
    expect(() => mintConfirmation("retire_credit", SLOTS)).toThrow(/A2A_JWT_SECRET/);
  });
});
