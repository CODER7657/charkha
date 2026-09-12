import { describe, it, expect } from "vitest";
import type { AssistantSlots } from "@charkha/core";
import { DeclareWasteInput } from "@charkha/core";
import { DECLARE_SLOTS, NEED_KEY, SUMMARY_KEY, planDeclare } from "./declare.ts";

/* ------------------------------------------------------------------ *
 * Planning a declaration is pure: slots in, "what is missing" or "here is
 * the call" out. It never reaches an agent, so everything below runs with no
 * database, no network and no mesh.
 * ------------------------------------------------------------------ */

const AT = { lat: 30.9, lon: 75.86 };
const WARD = "Ward 7, Ludhiana Municipal Corporation";

const full: AssistantSlots = { feedstock: "mixed", tonnes: 4.5, district: "Ludhiana" };
const ctx = { at: AT, declaredBy: WARD };

/** Narrowing helpers - a ready plan and a missing-slot plan are different shapes. */
const ready = (plan: ReturnType<typeof planDeclare>) => {
  if (!plan.ready) throw new Error(`expected a ready plan, still missing: ${plan.missing.join(", ")}`);
  return plan;
};
const pending = (plan: ReturnType<typeof planDeclare>) => {
  if (plan.ready) throw new Error("expected a plan that still needs something");
  return plan;
};

describe("saying what is still missing", () => {
  it("asks for everything when the sentence said nothing", () => {
    const plan = pending(planDeclare({}));
    expect(plan.missing).toEqual([...DECLARE_SLOTS]);
  });

  /* The issue's own case: two of three given. */
  it("asks only for the one thing outstanding", () => {
    const plan = pending(planDeclare({ feedstock: "mixed", tonnes: 4.5 }, { declaredBy: WARD }));
    expect(plan.missing).toEqual(["place"]);
    expect(plan.ask.key).toBe(NEED_KEY.place);
  });

  it("asks one question at a time, in the order a person would", () => {
    expect(pending(planDeclare({})).ask.key).toBe(NEED_KEY.feedstock);
    expect(pending(planDeclare({ feedstock: "mixed" })).ask.key).toBe(NEED_KEY.tonnes);
    expect(pending(planDeclare({ feedstock: "mixed", tonnes: 4.5 })).ask.key).toBe(NEED_KEY.place);
    expect(pending(planDeclare(full, { at: AT })).ask.key).toBe(NEED_KEY.declaredBy);
  });

  it("carries what it already knows, so the question can be specific", () => {
    const plan = pending(
      planDeclare({ feedstock: "paddy_straw", district: "Ludhiana" }, { declaredBy: WARD }),
    );
    expect(plan.ask.params).toEqual({ feedstock: "paddy_straw", district: "Ludhiana" });
  });

  /* A resolver that found nothing hands back "", and an empty declarer is the
     anonymous claim the contract exists to refuse. Absent and blank are the
     same state and must be asked for the same way. */
  it("treats a blank as absent, not as an answer", () => {
    for (const declaredBy of ["", "   "]) {
      const plan = pending(planDeclare({ ...full, declaredBy }, { at: AT }));
      expect(plan.missing, JSON.stringify(declaredBy)).toEqual(["declaredBy"]);
    }
  });

  it("treats a tonnage that is not a number as not yet given", () => {
    for (const tonnes of [0, -1, Number.NaN] as number[]) {
      const plan = pending(planDeclare({ ...full, tonnes }, ctx));
      expect(plan.missing, String(tonnes)).toEqual(["tonnes"]);
    }
  });

  /* It will not turn a district name into coordinates. A lot's point drives
     the road distance to a unit and therefore the transport debit on the
     credit - dropping every Ludhiana declaration onto one centroid would put
     a precision into a carbon number that nobody measured. */
  it("will not invent a place from a district name", () => {
    const plan = pending(
      planDeclare({ feedstock: "mixed", tonnes: 4.5, district: "Ludhiana" }, { declaredBy: WARD }),
    );
    expect(plan.missing).toEqual(["place"]);
  });
});

describe("building the declaration", () => {
  it("builds one the producer will accept", () => {
    const plan = ready(planDeclare(full, ctx));
    expect(() => DeclareWasteInput.parse(plan.input)).not.toThrow();
    expect(plan.input).toMatchObject({
      declaredBy: WARD,
      feedstock: "mixed",
      tonnes: 4.5,
      at: AT,
      district: "Ludhiana",
    });
  });

  /* Nothing in DeclareWasteInput can name a detection, so a declaration
     cannot borrow a satellite's credibility even by accident. */
  it("has no way to name a detection", () => {
    expect(ready(planDeclare(full, ctx)).input).not.toHaveProperty("sourceDetectionId");
  });

  it("says district null rather than empty string", () => {
    for (const district of [undefined, "", "  "]) {
      const plan = ready(planDeclare({ ...full, district }, ctx));
      expect(plan.input.district, JSON.stringify(district)).toBeNull();
    }
  });

  it("trims a declarer rather than storing the whitespace around them", () => {
    expect(ready(planDeclare(full, { ...ctx, declaredBy: `  ${WARD}  ` })).input.declaredBy).toBe(WARD);
  });

  /* The session beats the sentence: producerId becomes the credential's
     holder, and only the holder can retire that credit. If a typed "Ward 8
     declares..." could override who is signed in, anybody could mint credits
     into somebody else's name by saying so. */
  it("lets who is signed in win over who the sentence named", () => {
    const plan = ready(planDeclare({ ...full, declaredBy: "Ward 8" }, ctx));
    expect(plan.input.declaredBy).toBe(WARD);
  });

  it("keeps the declarer's note exactly as they wrote it", () => {
    const note = "wet, collect within 3 days";
    expect(ready(planDeclare(full, { ...ctx, note })).input.note).toBe(note);
  });

  it("omits a note nobody wrote", () => {
    for (const note of [undefined, "", "   "]) {
      expect(
        ready(planDeclare(full, { ...ctx, note })).input,
        JSON.stringify(note),
      ).not.toHaveProperty("note");
    }
  });

  it("leaves availableFrom to the agent unless it was given", () => {
    expect(ready(planDeclare(full, ctx)).input).not.toHaveProperty("availableFrom");
    const when = "2026-09-15T06:00:00.000Z";
    expect(ready(planDeclare(full, { ...ctx, availableFrom: when })).input.availableFrom).toBe(when);
  });

  it("summarises what is about to happen, for the confirmation", () => {
    const plan = ready(planDeclare(full, ctx));
    expect(plan.summary.key).toBe(SUMMARY_KEY);
    expect(plan.summary.params).toEqual({
      declaredBy: WARD,
      feedstock: "mixed",
      tonnes: 4.5,
      district: "Ludhiana",
    });
  });
});

describe("it says what to say, never the sentence itself", () => {
  it("returns keys, not prose", () => {
    const keys = [
      ...DECLARE_SLOTS.map((slot) => NEED_KEY[slot]),
      SUMMARY_KEY,
      pending(planDeclare({})).ask.key,
      ready(planDeclare(full, ctx)).summary.key,
    ];
    for (const key of keys) {
      expect(key, key).toMatch(/^assistant\.declare\.[a-z_]+$/);
      expect(key, key).not.toMatch(/\s/);
    }
  });

  it("gives every slot its own key, so no two questions collide", () => {
    const keys = DECLARE_SLOTS.map((slot) => NEED_KEY[slot]);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("it is pure, and it cannot fall over", () => {
  it("returns the same plan for the same slots", () => {
    expect(planDeclare(full, ctx)).toEqual(planDeclare(full, ctx));
  });

  it("does not modify the slots it was handed", () => {
    const slots: AssistantSlots = { ...full };
    planDeclare(slots, ctx);
    expect(slots).toEqual(full);
  });

  /* A resolver is a model; it will hand us nonsense. Nonsense must produce a
     question, or a payload the producer refuses with a 400 - never a throw,
     which a caller would see as the assistant falling over. */
  it("never throws, whatever a resolver hands it", () => {
    const nonsense: unknown[] = [
      {},
      { tonnes: Number.POSITIVE_INFINITY },
      { tonnes: 10_001, feedstock: "mixed" },
      { feedstock: "mixed", tonnes: 4.5, district: "x".repeat(500) },
      { declaredBy: "!".repeat(200), feedstock: "mixed", tonnes: 1 },
      { feedstock: undefined, tonnes: undefined, district: undefined },
    ];
    for (const slots of nonsense) {
      expect(() => planDeclare(slots as AssistantSlots, ctx), JSON.stringify(slots)).not.toThrow();
      expect(() => planDeclare(slots as AssistantSlots), JSON.stringify(slots)).not.toThrow();
    }
  });
});
