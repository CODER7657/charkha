import { describe, it, expect } from "vitest";
import type { AssistantSlots } from "@charkha/core";
import { DeclareWasteInput } from "@charkha/core";
import type { Plan } from "./types.ts";
import {
  CONFIRM_KEY,
  DECLARE_SLOTS,
  DONE_KEY,
  NEED_KEY,
  UNKNOWN_DISTRICT_KEY,
  planDeclare,
} from "./declare.ts";

/* ------------------------------------------------------------------ *
 * Planning a declaration is pure: slots in, a plan out. It never reaches an
 * agent, so everything below runs with no database, no network and no mesh.
 * ------------------------------------------------------------------ */

const WARD = "Ward 7, Ludhiana Municipal Corporation";
const full: AssistantSlots = {
  feedstock: "mixed",
  tonnes: 4.5,
  district: "Ludhiana",
  declaredBy: WARD,
};

/** Narrowing helpers - the three plan shapes have nothing in common. */
const write = (plan: Plan) => {
  if (plan.status !== "write") throw new Error(`expected a write plan, got "${plan.status}"`);
  return plan;
};
const need = (plan: Plan) => {
  if (plan.status !== "need") throw new Error(`expected a need plan, got "${plan.status}"`);
  return plan;
};

describe("saying what is still missing", () => {
  it("asks one question at a time, in the order a person would", () => {
    expect(need(planDeclare({})).reply.key).toBe(NEED_KEY.feedstock);
    expect(need(planDeclare({ feedstock: "mixed" })).reply.key).toBe(NEED_KEY.tonnes);
    expect(need(planDeclare({ feedstock: "mixed", tonnes: 4.5 })).reply.key).toBe(NEED_KEY.place);
    expect(need(planDeclare({ feedstock: "mixed", tonnes: 4.5, district: "Ludhiana" })).reply.key).toBe(
      NEED_KEY.declaredBy,
    );
  });

  it("carries what it already knows, so the question can be specific", () => {
    const plan = need(planDeclare({ feedstock: "paddy_straw", district: "Ludhiana" }));
    expect(plan.reply.params).toEqual({ feedstock: "paddy_straw", district: "Ludhiana" });
  });

  /* A resolver that found nothing hands back "", and an empty declarer is the
     anonymous claim the contract exists to refuse. Absent and blank are the
     same state and must be asked for the same way. */
  it("treats a blank as absent, not as an answer", () => {
    for (const declaredBy of ["", "   "]) {
      const plan = need(planDeclare({ ...full, declaredBy }));
      expect(plan.reply.key, JSON.stringify(declaredBy)).toBe(NEED_KEY.declaredBy);
    }
    for (const district of ["", "   "]) {
      const plan = need(planDeclare({ ...full, district }));
      expect(plan.reply.key, JSON.stringify(district)).toBe(NEED_KEY.place);
    }
  });

  it("treats a tonnage that is not a number as not yet given", () => {
    for (const tonnes of [0, -1, Number.NaN] as number[]) {
      expect(need(planDeclare({ ...full, tonnes })).reply.key, String(tonnes)).toBe(NEED_KEY.tonnes);
    }
  });

  /* Answering "Mumbai" is not the same as answering nothing. Asking "which
     district?" again would be a loop the person cannot get out of, so a
     district outside the belt gets its own answer. */
  it("says a district is outside the belt rather than asking again", () => {
    for (const district of ["Mumbai", "Chennai", "not a place"]) {
      const plan = need(planDeclare({ ...full, district }));
      expect(plan.reply.key, district).toBe(UNKNOWN_DISTRICT_KEY);
      expect(plan.reply.params["district"], district).toBe(district);
    }
  });

  it("nothing is called while anything is missing", () => {
    for (const slots of [{}, { feedstock: "mixed" as const }, { ...full, district: "Mumbai" }]) {
      expect(planDeclare(slots).status, JSON.stringify(slots)).toBe("need");
    }
  });
});

describe("proposing the declaration", () => {
  it("plans a write, never a read", () => {
    // It creates a lot and appends to an append-only ledger. Rule 5 means an
    // accidental one is permanent.
    expect(planDeclare(full).status).toBe("write");
  });

  it("calls the producer's declareWaste with something it will accept", () => {
    const plan = write(planDeclare(full));
    expect(plan.call.agent).toBe("producer");
    expect(plan.call.skill).toBe("declareWaste");
    expect(() => DeclareWasteInput.parse(plan.call.input)).not.toThrow();
  });

  it("puts the sentence's own numbers in the call", () => {
    expect(write(planDeclare(full)).call.input).toMatchObject({
      declaredBy: WARD,
      feedstock: "mixed",
      tonnes: 4.5,
      district: "Ludhiana",
    });
  });

  /* Nothing in DeclareWasteInput can name a detection, so a declaration
     cannot borrow a satellite's credibility even by accident. */
  it("has no way to name a detection", () => {
    expect(write(planDeclare(full)).call.input).not.toHaveProperty("sourceDetectionId");
  });

  /* A sentence gives a district and nothing finer, and the contract requires
     a point. The centre of the named district is the only honest reading of
     "in Ludhiana" - and it is the district's centre, not the waste's. */
  it("places the lot at the centre of the district that was named", () => {
    const { at } = write(planDeclare(full)).call.input as { at: { lat: number; lon: number } };
    // Ludhiana's centroid, the same table the producer labels detections with.
    expect(at).toEqual({ lat: 30.9, lon: 75.86 });
  });

  it("finds a district however it was typed", () => {
    for (const district of ["ludhiana", "  LUDHIANA  ", "Ludhiana"]) {
      const plan = write(planDeclare({ ...full, district }));
      expect((plan.call.input as { at: unknown }).at, district).toEqual({ lat: 30.9, lon: 75.86 });
    }
  });

  it("trims a declarer rather than storing the whitespace around them", () => {
    const plan = write(planDeclare({ ...full, declaredBy: `  ${WARD}  ` }));
    expect((plan.call.input as { declaredBy: string }).declaredBy).toBe(WARD);
  });

  /* The token is an HMAC bound to this intent and these slots, so the summary
     and the call are guaranteed to describe the same action. That makes
     naming the specifics safe - and hedging pointless. */
  it("summarises the real numbers, not a hedge", () => {
    const plan = write(planDeclare(full));
    expect(plan.summary.key).toBe(CONFIRM_KEY);
    expect(plan.summary.params).toEqual({
      declaredBy: WARD,
      feedstock: "mixed",
      tonnes: 4.5,
      district: "Ludhiana",
    });
  });

  it("agrees with itself: what is summarised is what gets called", () => {
    const plan = write(planDeclare(full));
    const input = plan.call.input as { tonnes: number; feedstock: string; declaredBy: string };
    expect(plan.summary.params["tonnes"]).toBe(input.tonnes);
    expect(plan.summary.params["feedstock"]).toBe(input.feedstock);
    expect(plan.summary.params["declaredBy"]).toBe(input.declaredBy);
  });
});

describe("reporting what came back", () => {
  const plan = () => write(planDeclare(full));

  it("names the lot the declaration became", () => {
    const done = plan().done({
      lot: { lotId: "lot_abc", tonnes: 4.5, feedstock: "mixed", district: "Ludhiana" },
    });
    expect(done.key).toBe(DONE_KEY);
    expect(done.params["lotId"]).toBe("lot_abc");
    expect(done.params["tonnes"]).toBe(4.5);
  });

  /* The producer is the authority on what was stored - it decides the lot id
     and could clamp or normalise anything else. Reporting what we asked for
     rather than what came back is how a confirmation stops being evidence. */
  it("reports what the producer stored, not what was asked for", () => {
    const done = plan().done({
      lot: { lotId: "lot_abc", tonnes: 4.4, feedstock: "mixed", district: "Ludhiana" },
    });
    expect(done.params["tonnes"]).toBe(4.4);
  });

  /* `done` is handed whatever the agent returned. A shape we did not expect
     must still render a sentence - the write already happened, and throwing
     here would report a successful declaration as a failure. */
  it("still says something when the output is not what we expected", () => {
    for (const output of [null, undefined, {}, { lot: null }, "nonsense", 42]) {
      expect(() => plan().done(output), JSON.stringify(output)).not.toThrow();
      expect(plan().done(output).key, JSON.stringify(output)).toBe(DONE_KEY);
    }
  });
});

describe("it says what to say, never the sentence itself", () => {
  it("returns keys, not prose", () => {
    const keys = [
      ...DECLARE_SLOTS.map((slot) => NEED_KEY[slot]),
      UNKNOWN_DISTRICT_KEY,
      CONFIRM_KEY,
      DONE_KEY,
      need(planDeclare({})).reply.key,
      write(planDeclare(full)).summary.key,
      write(planDeclare(full)).done({ lot: { lotId: "lot_a" } }).key,
    ];
    for (const key of keys) {
      expect(key, key).toMatch(/^assistant\.declare\.[a-z_]+$/);
      expect(key, key).not.toMatch(/\s/);
    }
  });

  it("gives every question its own key, so no two collide", () => {
    const keys = [...DECLARE_SLOTS.map((slot) => NEED_KEY[slot]), UNKNOWN_DISTRICT_KEY, CONFIRM_KEY, DONE_KEY];
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("it is pure, and it cannot fall over", () => {
  it("returns the same plan for the same slots", () => {
    const a = write(planDeclare(full));
    const b = write(planDeclare(full));
    expect(a.call).toEqual(b.call);
    expect(a.summary).toEqual(b.summary);
  });

  it("does not modify the slots it was handed", () => {
    const slots: AssistantSlots = { ...full };
    planDeclare(slots);
    expect(slots).toEqual(full);
  });

  it("hands out a copy of the centroid, not the table's own row", () => {
    const at = (write(planDeclare(full)).call.input as { at: { lat: number } }).at;
    at.lat = 0;
    const again = (write(planDeclare(full)).call.input as { at: { lat: number } }).at;
    expect(again.lat).toBe(30.9);
  });

  /* A resolver is a model; it will hand us nonsense. Nonsense must produce a
     question, or a payload the producer refuses with a 400 - never a throw,
     which a caller would see as the assistant falling over. */
  it("never throws, whatever a resolver hands it", () => {
    const nonsense: unknown[] = [
      {},
      { tonnes: Number.POSITIVE_INFINITY },
      { tonnes: 10_001, feedstock: "mixed", district: "Ludhiana", declaredBy: "x" },
      { ...full, district: "x".repeat(500) },
      { ...full, declaredBy: "!".repeat(200) },
      { feedstock: undefined, tonnes: undefined, district: undefined },
    ];
    for (const slots of nonsense) {
      expect(() => planDeclare(slots as AssistantSlots), JSON.stringify(slots)).not.toThrow();
    }
  });
});
