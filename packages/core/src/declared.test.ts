import { describe, it, expect } from "vitest";
import {
  AssistantAnswerOutput,
  AssistantAskInput,
  DeclareWasteInput,
  ResidueLot,
  WasteOrigin,
} from "./contracts.ts";

const lot = (over: Record<string, unknown> = {}) => ({
  lotId: "lot_a",
  producerId: "ward_7",
  at: { lat: 30.9, lon: 75.86 },
  district: "Ludhiana",
  feedstock: "mixed" as const,
  tonnes: 3,
  availableFrom: "2026-09-12T08:00:00.000Z",
  sourceDetectionId: null,
  status: "listed" as const,
  ...over,
});

/* ------------------------------------------------------------------ *
 * Declared waste is not detected waste.
 *
 * A satellite detection is independent evidence - NASA saw a thermal anomaly
 * whether or not anyone wanted it seen. A declaration is a claim by somebody
 * who stands to be paid for it. A carbon system that lets those two look the
 * same is doing the thing carbon markets are criticised for.
 *
 * Both paths have to exist: FIRMS finds fire, so a municipality landfilling
 * organic waste and a factory filling a skip are structurally invisible to it.
 * Declaration is how they enter at all. It is not a lesser lot - it is an
 * honestly labelled one.
 * ------------------------------------------------------------------ */

describe("a declared lot is never mistaken for a detected one", () => {
  it("has exactly two origins, and no third", () => {
    expect(WasteOrigin.options).toEqual(["detected", "declared"]);
  });

  it("carries the origin through the lot contract", () => {
    expect(ResidueLot.parse(lot({ origin: "declared" })).origin).toBe("declared");
    expect(ResidueLot.parse(lot({ origin: "detected", sourceDetectionId: "det_1" })).origin).toBe(
      "detected",
    );
  });

  it("refuses an origin we did not define", () => {
    expect(() => ResidueLot.parse(lot({ origin: "estimated" }))).toThrow();
    expect(() => ResidueLot.parse(lot({ origin: "" }))).toThrow();
  });

  /* Optional while the declare path is built separately - every lot that
     exists today is detected, and requiring it would force a value into call
     sites that have nothing to say about it yet. Absent reads as detected;
     it must never read as declared. */
  it("is absent rather than guessed on lots that predate the field", () => {
    const parsed = ResidueLot.parse(lot());
    expect(parsed.origin).toBeUndefined();
    expect(parsed.origin).not.toBe("declared");
  });
});

describe("declaring waste", () => {
  const declaration = {
    declaredBy: "Ward 7, Ludhiana Municipal Corporation",
    feedstock: "mixed" as const,
    tonnes: 4.5,
    at: { lat: 30.9, lon: 75.86 },
    district: "Ludhiana",
  };

  it("accepts a municipality declaring organic waste", () => {
    const parsed = DeclareWasteInput.parse(declaration);
    expect(parsed.declaredBy).toContain("Ward 7");
    expect(parsed.tonnes).toBe(4.5);
  });

  /* The declarer is the whole point of the record. An anonymous declaration is
     a claim nobody is accountable for, which is worth less than no claim. */
  it("refuses a declaration with nobody attached to it", () => {
    expect(() => DeclareWasteInput.parse({ ...declaration, declaredBy: "" })).toThrow();
    const { declaredBy: _omitted, ...anonymous } = declaration;
    expect(() => DeclareWasteInput.parse(anonymous)).toThrow();
  });

  it("refuses impossible tonnages", () => {
    for (const tonnes of [0, -1, 10_001, Number.NaN]) {
      expect(() => DeclareWasteInput.parse({ ...declaration, tonnes }), String(tonnes)).toThrow();
    }
  });

  it("refuses a feedstock outside the closed set", () => {
    expect(() => DeclareWasteInput.parse({ ...declaration, feedstock: "plastic" })).toThrow();
  });

  /* A declaration carries no detection id by construction. Nothing in this
     input can even express one, so a declared lot cannot borrow a satellite's
     credibility by accident. */
  it("has no way to name a detection", () => {
    const parsed = DeclareWasteInput.parse({ ...declaration, sourceDetectionId: "det_1" });
    expect(parsed).not.toHaveProperty("sourceDetectionId");
  });
});

/* ------------------------------------------------------------------ *
 * The assistant's safety model: a sentence may plan a write, but only a
 * confirmed token performs one.
 * ------------------------------------------------------------------ */

describe("the assistant never writes on the first ask", () => {
  it("defaults to no confirmation, nothing performed, no hops", () => {
    const answer = AssistantAnswerOutput.parse({
      intent: "how_it_works",
      slots: {},
      confidence: 0.9,
      reply: { key: "assistant.how_it_works" },
    });
    expect(answer.confirmation).toBeNull();
    expect(answer.performed).toBe(false);
    expect(answer.hops).toEqual([]);
    expect(answer.data).toBeNull();
  });

  it("carries a token when a write is proposed, and still has not performed it", () => {
    const answer = AssistantAnswerOutput.parse({
      intent: "declare_waste",
      slots: { tonnes: 3, feedstock: "mixed", district: "Ludhiana" },
      confidence: 0.82,
      reply: { key: "assistant.confirm_declare" },
      confirmation: { token: "cfm_abc", summary: { key: "assistant.declare_summary" } },
    });
    expect(answer.confirmation?.token).toBe("cfm_abc");
    expect(answer.performed).toBe(false);
  });

  /* Prose cannot be translated after the fact - the verifier's English
     `reasons` render untranslated on a Punjabi screen for exactly this reason.
     The assistant returns a key and parameters so the client picks the
     language. */
  it("says what to say, not the finished sentence", () => {
    const answer = AssistantAnswerOutput.parse({
      intent: "impact_summary",
      slots: { district: "Ludhiana" },
      confidence: 0.95,
      reply: { key: "assistant.impact", params: { tonnes: 12.5, district: "Ludhiana" } },
    });
    expect(answer.reply.key).toBe("assistant.impact");
    expect(answer.reply.params["tonnes"]).toBe(12.5);
  });

  it("defaults an ask to English and no confirmation", () => {
    const ask = AssistantAskInput.parse({ utterance: "what happened to my waste" });
    expect(ask.lang).toBe("en");
    expect(ask.confirm).toBeUndefined();
  });

  it("accepts all four languages and refuses a fifth", () => {
    for (const lang of ["en", "hi", "pa", "gu"]) {
      expect(AssistantAskInput.parse({ utterance: "x", lang }).lang).toBe(lang);
    }
    expect(() => AssistantAskInput.parse({ utterance: "x", lang: "fr" })).toThrow();
  });

  /* An assistant that can attempt anything can be talked into anything. */
  it("refuses an empty utterance and one past the length cap", () => {
    expect(() => AssistantAskInput.parse({ utterance: "" })).toThrow();
    expect(() => AssistantAskInput.parse({ utterance: "x".repeat(501) })).toThrow();
  });
});
