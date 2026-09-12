import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { AgentRequestError } from "@charkha/a2a";
import type { AssistantSlots, ResidueLot } from "@charkha/core";
import { makePlanner, PLANNERS as WIRED, type PlannerTable, type Resolved } from "./planner.ts";
import type { PlannedCall } from "./plan/types.ts";
import { makeAnswer, MIN_CONFIDENCE, unresolved } from "./answer.ts";
import { planLotStatus, planImpactSummary } from "./plan/lots.ts";
import { planRunMatching } from "./plan/matching.ts";
import { mintConfirmation } from "./confirm.ts";

/* ------------------------------------------------------------------ *
 * The planner is where a sentence acquires consequences.
 *
 * The planning modules are pure and easy. Everything dangerous lives here:
 * whether a write runs, whether a weak match can reach a mutating intent, and
 * what happens when an agent refuses. So this file is mostly about refusals.
 * ------------------------------------------------------------------ */

const lot = (over: Partial<ResidueLot> = {}): ResidueLot => ({
  lotId: "lot_a",
  producerId: "ward_7",
  at: { lat: 30.9, lon: 75.86 },
  district: "Ludhiana",
  feedstock: "mixed",
  tonnes: 3,
  availableFrom: "2026-09-12T08:00:00.000Z",
  sourceDetectionId: "det_1",
  status: "listed",
  ...over,
});

const PLANNERS: PlannerTable = {
  lot_status: planLotStatus,
  impact_summary: planImpactSummary,
  run_matching: planRunMatching,
};

const ctx = { taskId: "task_1", contextId: "ctx_1", progress: () => {} };

const setup = (output: unknown = { lots: [lot()] }) => {
  const call = vi.fn(async (_c: PlannedCall) => ({ taskId: "task_x", output }));
  const plan = makePlanner({ planners: PLANNERS, call, now: () => 1_000_000 });
  return { call, plan };
};

const resolvedAs = (over: Partial<Resolved>): Resolved => ({
  intent: "lot_status",
  slots: {},
  confidence: 0.9,
  ...over,
});

describe("reads run immediately", () => {
  beforeEach(() => {
    process.env["A2A_JWT_SECRET"] = "test-secret";
  });
  afterEach(() => {
    delete process.env["A2A_JWT_SECRET"];
  });

  it("asks the producer and summarises what came back", async () => {
    const { call, plan } = setup({ lots: [lot(), lot({ lotId: "b", status: "credited" })] });
    const out = await plan(resolvedAs({ slots: { district: "Ludhiana" } }), undefined, () => {});

    expect(call).toHaveBeenCalledOnce();
    expect(out.reply.key).toBe("assistant.lots.summary");
    expect(out.reply.params["total"]).toBe(2);
    expect(out.performed).toBe(false);
    expect(out.confirmation).toBeNull();
  });

  /* The hops are the evidence that a mesh answered, not one service. */
  it("reports the agent it called, with a task id", async () => {
    const { plan } = setup();
    const out = await plan(resolvedAs({ slots: { district: "Ludhiana" } }), undefined, () => {});
    expect(out.hops).toEqual([
      { agent: "producer", skill: "listLots", taskId: "task_x", ms: 0, ok: true },
    ]);
  });

  it("says what is missing instead of guessing a district", async () => {
    const { call, plan } = setup();
    const out = await plan(resolvedAs({ slots: {} }), undefined, () => {});
    expect(out.reply.key).toBe("assistant.lots.need_district");
    expect(call).not.toHaveBeenCalled();
  });

  /* Declared and detected are different evidence, so the answer counts them
     apart rather than quietly averaging a ward's own word with NASA's. */
  it("counts declared lots separately from detected ones", async () => {
    const { plan } = setup({
      lots: [lot(), lot({ lotId: "b", origin: "declared", sourceDetectionId: null })],
    });
    const out = await plan(resolvedAs({ slots: { district: "Ludhiana" } }), undefined, () => {});
    expect(out.reply.params["total"]).toBe(2);
    expect(out.reply.params["declared"]).toBe(1);
  });

  it("reports potential separately from what was actually credited", async () => {
    const { plan } = setup({ lots: [lot({ tonnes: 10 }), lot({ lotId: "b", tonnes: 10, status: "credited" })] });
    const out = await plan(
      resolvedAs({ intent: "impact_summary", slots: { district: "Ludhiana" } }),
      undefined,
      () => {},
    );
    expect(out.reply.key).toBe("assistant.impact.summary");
    expect(Number(out.reply.params["potentialTco2e"])).toBeGreaterThan(
      Number(out.reply.params["creditedTco2e"]),
    );
    // Every number we publish carries a source - rule 7.
    expect(String(out.reply.params["source"])).toMatch(/IPCC/);
  });
});

describe("writes are proposed, never performed", () => {
  beforeEach(() => {
    process.env["A2A_JWT_SECRET"] = "test-secret";
  });
  afterEach(() => {
    delete process.env["A2A_JWT_SECRET"];
  });

  it("proposes a matching round and calls nothing", async () => {
    const { call, plan } = setup();
    const out = await plan(resolvedAs({ intent: "run_matching", slots: {} }), undefined, () => {});

    expect(call).not.toHaveBeenCalled();
    expect(out.performed).toBe(false);
    expect(out.confirmation?.token).toBeTruthy();
    // The radius decides the outcome, so it is in what the user agrees to.
    expect(out.reply.params["radiusKm"]).toBe(60);
  });

  it("performs it once the token comes back", async () => {
    const { call, plan } = setup({ matches: [{}, {}], unmatchedLotIds: ["a"] });
    const slots: AssistantSlots = { radiusKm: 75 };
    const token = mintConfirmation("run_matching", slots, 1_000_000);

    const out = await plan(resolvedAs({ intent: "run_matching", slots }), token, () => {});

    expect(call).toHaveBeenCalledOnce();
    expect(out.performed).toBe(true);
    expect(out.reply.key).toBe("assistant.matching.done");
    expect(out.reply.params["matched"]).toBe(2);
  });

  /* A round that placed nothing is a result. Six lots out of range is the
     catchment constraint working, and the ledger records that we looked. */
  it("reports a round that matched nothing as a result, not a failure", async () => {
    const { plan } = setup({ matches: [], unmatchedLotIds: ["a", "b"] });
    const slots: AssistantSlots = {};
    const token = mintConfirmation("run_matching", slots, 1_000_000);
    const out = await plan(resolvedAs({ intent: "run_matching", slots }), token, () => {});

    expect(out.performed).toBe(true);
    expect(out.reply.key).toBe("assistant.matching.none");
    expect(out.reply.params["unplaced"]).toBe(2);
  });

  /* THE ONE THAT MATTERS. A token issued for one action must not spend on
     another - otherwise the confirmation step is theatre. */
  it("refuses a token minted for different slots, and does not re-propose", async () => {
    const { call, plan } = setup();
    const token = mintConfirmation("run_matching", { radiusKm: 60 }, 1_000_000);

    const out = await plan(resolvedAs({ intent: "run_matching", slots: { radiusKm: 115 } }), token, () => {});

    expect(call).not.toHaveBeenCalled();
    expect(out.performed).toBe(false);
    expect(out.reply.key).toBe("assistant.confirm.mismatch");
    // No fresh token: the request changed after the proposal, which is exactly
    // what the binding exists to stop.
    expect(out.confirmation).toBeNull();
  });

  /* A stale tab is the common case, and making someone retype the sentence to
     recover from our own five-minute window punishes reading carefully. */
  it("re-proposes when a token has merely expired", async () => {
    const { call, plan } = setup();
    const token = mintConfirmation("run_matching", {}, 0);

    const out = await plan(resolvedAs({ intent: "run_matching", slots: {} }), token, () => {});

    expect(call).not.toHaveBeenCalled();
    expect(out.reply.key).toBe("assistant.confirm.expired");
    expect(out.confirmation?.token).toBeTruthy();
  });
});

describe("when an agent will not answer", () => {
  beforeEach(() => {
    process.env["A2A_JWT_SECRET"] = "test-secret";
  });
  afterEach(() => {
    delete process.env["A2A_JWT_SECRET"];
  });

  it("repeats a refusal and marks the hop failed", async () => {
    const call = vi.fn(async () => {
      throw new AgentRequestError("producer", "listLots", "no such district");
    });
    const plan = makePlanner({ planners: PLANNERS, call, now: () => 1_000_000 });
    const out = await plan(resolvedAs({ slots: { district: "Nowhere" } }), undefined, () => {});

    expect(out.reply.key).toBe("assistant.refused");
    expect(out.hops[0]?.ok).toBe(false);
    expect(out.hops[0]?.taskId).toBeNull();
  });

  /**
   * The agent's own message is written for a developer, in English. `t()`
   * cannot reach inside a parameter, so anything we pass through arrives
   * untranslated on a Punjabi screen - the same failure the verifier had with
   * `reasons`. What the user reads is a key; the detail is kept in `data`,
   * where it is evidence rather than a sentence.
   */
  it("never puts the agent's own words in what the user reads", async () => {
    const detail =
      "registry.retireCredit: refusing to retire crd_00000000000000000001: retiredBy does not match the credit's holder";
    const call = vi.fn(async () => {
      throw new AgentRequestError("registry", "retireCredit", detail);
    });
    const retire: PlannerTable = {
      retire_credit: () => ({
        status: "write",
        summary: { key: "assistant.credit.retire_summary", params: {} },
        call: { agent: "registry", skill: "retireCredit", input: {} },
        done: () => ({ key: "assistant.credit.retired", params: {} }),
      }),
    };
    const plan = makePlanner({ planners: retire, call, now: () => 1_000_000 });
    const resolved = resolvedAs({ intent: "retire_credit", slots: { creditId: "crd_00000000000000000001" } });
    const token = mintConfirmation("retire_credit", resolved.slots, 1_000_000);

    const out = await plan(resolved, token, () => {});

    /* The refusal itself still worked. */
    expect(out.performed).toBe(false);
    expect(out.hops[0]?.ok).toBe(false);

    /* An intent whose refusal deserves its own sentence gets one. */
    expect(out.reply.key).toBe("assistant.refused.retire_credit");

    /* And not a word of the agent's English reaches the reply. */
    const rendered = JSON.stringify(out.reply);
    expect(rendered).not.toContain("retiredBy");
    expect(rendered).not.toContain("refusing to retire");
    expect(rendered).not.toContain("registry.retireCredit");

    /* Kept where whoever is debugging will look for it. */
    expect(JSON.stringify(out.data)).toContain("retiredBy");
  });

  it("falls back to the generic refusal for an intent with no copy of its own", async () => {
    const call = vi.fn(async () => {
      throw new AgentRequestError("producer", "listLots", "no such district: Nowhere");
    });
    const plan = makePlanner({ planners: PLANNERS, call, now: () => 1_000_000 });
    const out = await plan(resolvedAs({ slots: { district: "Nowhere" } }), undefined, () => {});

    expect(out.reply.key).toBe("assistant.refused");
    expect(JSON.stringify(out.reply)).not.toContain("no such district");
  });

  /* Our own breakage must not be dressed up as an answer to the user. */
  it("does not report our outage as a refusal", async () => {
    const call = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    });
    const plan = makePlanner({ planners: PLANNERS, call, now: () => 1_000_000 });
    const out = await plan(resolvedAs({ slots: { district: "Ludhiana" } }), undefined, () => {});
    expect(out.reply.key).toBe("assistant.unavailable");
  });

  /* An intent whose module has not landed yet answers "not understood" rather
     than throwing. Degrading into a sentence beats degrading into a 500. */
  it("handles an intent with no planner yet", async () => {
    const { call, plan } = setup();
    const out = await plan(resolvedAs({ intent: "declare_waste", slots: {} }), undefined, () => {});
    expect(out.reply.key).toBe("assistant.not_understood");
    expect(call).not.toHaveBeenCalled();
  });
});

describe("a weak match never reaches a planner", () => {
  beforeEach(() => {
    process.env["A2A_JWT_SECRET"] = "test-secret";
  });
  afterEach(() => {
    delete process.env["A2A_JWT_SECRET"];
  });

  /* The gate is in answer.ts, above the planner, so a low-confidence
     `retire_credit` cannot reach a planning module at all. */
  it("downgrades a low-confidence mutating intent to unknown", async () => {
    const { call, plan } = setup();
    const run = makeAnswer({
      resolve: () => ({ intent: "run_matching", slots: {}, confidence: MIN_CONFIDENCE - 0.01 }),
      plan,
    });

    const out = await run({ utterance: "maybe do the thing", lang: "en", confirm: undefined }, ctx);

    expect(out.intent).toBe("unknown");
    expect(out.reply.key).toBe("assistant.not_understood");
    expect(out.confirmation).toBeNull();
    expect(call).not.toHaveBeenCalled();
  });

  it("lets a confident intent through", async () => {
    const { plan } = setup();
    const run = makeAnswer({
      resolve: () => ({ intent: "lot_status", slots: { district: "Ludhiana" }, confidence: 0.9 }),
      plan,
    });
    const out = await run({ utterance: "what happened to our waste", lang: "pa", confirm: undefined }, ctx);
    expect(out.intent).toBe("lot_status");
    expect(out.reply.key).toBe("assistant.lots.summary");
  });

  /* Until Hem's resolver lands the agent answers unknown for everything, and
     that is the correct production behaviour for an unplaceable sentence too. */
  it("answers unknown while no resolver is wired", async () => {
    const { plan } = setup();
    const run = makeAnswer({ resolve: unresolved, plan });
    const out = await run({ utterance: "retire everything", lang: "en", confirm: undefined }, ctx);
    expect(out.intent).toBe("unknown");
    expect(out.performed).toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * The credit intents, through the table the agent actually uses.
 *
 * Not a local PLANNERS built for the test - `WIRED` is the real export, so
 * if the two lines are ever removed these fail rather than quietly passing
 * against a stand-in. Every assertion is on keys and structure.
 * ------------------------------------------------------------------ */
const CREDIT = {
  creditId: "crd_00000000000000000001",
  matchId: "mat_1",
  evidenceId: "evi_1",
  netTonnesCo2e: 2.483,
  breakdown: { grossSequestrationTco2e: 2.6, transportDebitTco2e: 0.05, processDebitTco2e: 0.07 },
  issuedAt: "2026-09-12T09:00:00.000Z",
  status: "issued" as const,
  credentialJwt: `${Buffer.from(JSON.stringify({ alg: "EdDSA" })).toString("base64url")}.${Buffer.from(
    JSON.stringify({ vc: { credentialStatus: { statusListCredential: "https://charkha.example.com/status/credits" } } }),
  ).toString("base64url")}.c2ln`,
  credentialId: "urn:charkha:credential:crd_00000000000000000001",
  issuerDid: "did:key:z6MkExample",
  holder: "prod_sangrur",
  statusListIndex: 11,
};

describe("the credit intents are wired", () => {
  beforeEach(() => {
    process.env["A2A_JWT_SECRET"] = "test-secret";
    process.env["PUBLIC_BASE_URL"] = "https://charkha.example.com";
  });
  afterEach(() => {
    delete process.env["A2A_JWT_SECRET"];
    delete process.env["PUBLIC_BASE_URL"];
  });

  it("answers credit_status by reading, and only reading", async () => {
    const call = vi.fn(async () => ({ taskId: "t_1", output: { credit: CREDIT } }));
    const plan = makePlanner({ planners: WIRED, call, now: () => 1_000_000 });

    const out = await plan(
      resolvedAs({ intent: "credit_status", slots: { creditId: CREDIT.creditId } }),
      undefined,
      () => {},
    );

    expect(out.reply.key).toBe("assistant.credit.status");
    expect(out.reply.params).toMatchObject({ creditId: CREDIT.creditId, tonnes: 2.483, holder: "prod_sangrur" });
    expect(out.hops.map((h) => h.skill)).toEqual(["lookupCredit"]);
    expect(out.performed).toBe(false);
    expect(out.confirmation).toBeNull();
  });

  it("tells someone a credential cannot be checked, without calling it invalid", async () => {
    /* The pre-#47 credentials on the deployed host name a docker-internal
       host. They verify. They are not verifiable, and a person is told which. */
    const stale = {
      ...CREDIT,
      credentialJwt: `${Buffer.from(JSON.stringify({ alg: "EdDSA" })).toString("base64url")}.${Buffer.from(
        JSON.stringify({ vc: { credentialStatus: { statusListCredential: "http://registry:4004/status/credits" } } }),
      ).toString("base64url")}.c2ln`,
    };
    const call = vi.fn(async () => ({ taskId: "t_1", output: { credit: stale } }));
    const plan = makePlanner({ planners: WIRED, call, now: () => 1_000_000 });

    const out = await plan(
      resolvedAs({ intent: "credit_status", slots: { creditId: CREDIT.creditId } }),
      undefined,
      () => {},
    );

    expect(out.reply.key).toBe("assistant.credit.status_not_verifiable");
    expect(out.reply.params["reason"]).toBe("assistant.reason.unreachable_list");
    /* Still says what it is. */
    expect(out.reply.params["status"]).toBe("assistant.status.issued");
  });

  it("proposes a retirement without calling anything, then performs it on the token", async () => {
    const call = vi.fn(async () => ({ taskId: "t_2", output: { credit: { ...CREDIT, status: "retired" as const } } }));
    const plan = makePlanner({ planners: WIRED, call, now: () => 1_000_000 });
    const resolved = resolvedAs({
      intent: "retire_credit",
      slots: { creditId: CREDIT.creditId, holder: CREDIT.holder },
    });

    const proposed = await plan(resolved, undefined, () => {});
    expect(proposed.reply.key).toBe("assistant.credit.retire_summary");
    expect(proposed.performed).toBe(false);
    expect(proposed.confirmation).not.toBeNull();
    /* The proposal called nothing at all. */
    expect(call).not.toHaveBeenCalled();
    expect(proposed.hops).toEqual([]);

    const done = await plan(resolved, proposed.confirmation!.token, () => {});
    expect(done.performed).toBe(true);
    expect(done.reply.key).toBe("assistant.credit.retired_detail");
    expect(done.reply.params).toMatchObject({ tonnes: 2.483, status: "assistant.status.retired" });
    expect(done.hops.map((h) => h.skill)).toEqual(["retireCredit"]);
  });

  it("will not spend a confirmation issued for a different credit", async () => {
    const call = vi.fn(async () => ({ taskId: "t_3", output: { credit: CREDIT } }));
    const plan = makePlanner({ planners: WIRED, call, now: () => 1_000_000 });

    const forOther = mintConfirmation(
      "retire_credit",
      { creditId: "crd_00000000000000000002", holder: CREDIT.holder },
      1_000_000,
    );
    const out = await plan(
      resolvedAs({ intent: "retire_credit", slots: { creditId: CREDIT.creditId, holder: CREDIT.holder } }),
      forOther,
      () => {},
    );

    expect(out.performed).toBe(false);
    expect(out.reply.key).toBe("assistant.confirm.mismatch");
    expect(call).not.toHaveBeenCalled();
  });
});
