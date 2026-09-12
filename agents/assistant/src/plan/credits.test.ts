import { describe, it, expect, afterEach } from "vitest";
import type { AssistantSlots, CreditRecord } from "@charkha/core";
import { planCreditStatus, planRetire, verifiabilityOf } from "./credits.ts";

/* ------------------------------------------------------------------ *
 * A SENTENCE PROPOSES A RETIREMENT. IT NEVER PERFORMS ONE.
 *
 * Retirement is terminal and irreversible, and "retire my credit" is a
 * sentence people type faster than they think.
 *
 * Assertions are on keys and structure, never wording - the module emits
 * `{ key, params }` exactly so the sentence belongs to the client, in the
 * reader's language.
 * ------------------------------------------------------------------ */

const PUBLIC_ORIGIN = "https://charkha-hashhawks.centralindia.cloudapp.azure.com";
const CREDIT_ID = "crd_00000000000000000001";

/** A credential naming `url` as its status list. Only the payload is read. */
const credentialNaming = (url: string | null): string => {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const vc = url
    ? { vc: { credentialStatus: { statusListCredential: url, statusListIndex: "10" } } }
    : { vc: {} };
  return `${b64({ alg: "EdDSA", typ: "JWT" })}.${b64(vc)}.c2lnbmF0dXJl`;
};

const CREDIT: CreditRecord = {
  creditId: CREDIT_ID,
  matchId: "mat_1",
  evidenceId: "evi_1",
  netTonnesCo2e: 1.05,
  breakdown: { grossSequestrationTco2e: 1.24, transportDebitTco2e: 0.05, processDebitTco2e: 0.14 },
  issuedAt: "2026-09-12T04:10:00.000Z",
  status: "issued",
  credentialJwt: credentialNaming(`${PUBLIC_ORIGIN}/status/credits`),
  credentialId: `urn:charkha:credential:${CREDIT_ID}`,
  issuerDid: "did:key:z6MkExampleIssuer",
  holder: "prod_bathinda",
  statusListIndex: 10,
};

const credit = (over: Partial<CreditRecord> = {}): CreditRecord => ({ ...CREDIT, ...over });
const slots = (over: Partial<AssistantSlots> = {}): AssistantSlots => ({
  creditId: CREDIT_ID,
  holder: CREDIT.holder,
  ...over,
});

/** The deployment's public origin is configuration, so tests set it explicitly. */
const withOrigin = (value: string | undefined) => {
  if (value === undefined) delete process.env["PUBLIC_BASE_URL"];
  else process.env["PUBLIC_BASE_URL"] = value;
};
afterEach(() => delete process.env["PUBLIC_BASE_URL"]);

describe("credit_status", () => {
  it("asks for a credit id rather than guessing", () => {
    const plan = planCreditStatus({});
    expect(plan.status).toBe("need");
    if (plan.status === "need") expect(plan.reply.key).toBe("assistant.credit.need_id");
  });

  it("asks again when the id is not one of ours", () => {
    const plan = planCreditStatus({ creditId: "crd_nope" });
    expect(plan.status).toBe("need");
    if (plan.status === "need") expect(plan.reply.key).toBe("assistant.credit.malformed_id");
  });

  it("reads, and reads only", () => {
    const plan = planCreditStatus(slots());
    expect(plan.status).toBe("read");
    if (plan.status !== "read") return;
    expect(plan.calls).toEqual([{ agent: "registry", skill: "lookupCredit", input: { creditId: CREDIT_ID } }]);
  });

  it("answers with the figures a person asked for", () => {
    withOrigin(PUBLIC_ORIGIN);
    const plan = planCreditStatus(slots());
    if (plan.status !== "read") throw new Error("expected a read");

    const reply = plan.reply([{ credit: credit() }]);
    expect(reply.key).toBe("assistant.credit.status");
    expect(reply.params).toMatchObject({ creditId: CREDIT_ID, status: "issued", tonnes: 1.05, holder: "prod_bathinda" });
  });

  /* The distinction this issue is really about. */
  it("reports a credential whose list cannot be reached as NOT VERIFIABLE, not as invalid", () => {
    withOrigin(PUBLIC_ORIGIN);
    const plan = planCreditStatus(slots());
    if (plan.status !== "read") throw new Error("expected a read");

    const stale = credit({ credentialJwt: credentialNaming("http://registry:4004/status/credits") });
    const reply = plan.reply([{ credit: stale }]);

    expect(reply.key).toBe("assistant.credit.status_not_verifiable");
    expect(reply.params["reason"]).toBe("unreachable_list");
    expect(reply.params["listHost"]).toBe("http://registry:4004");
    /* Still says what the credit IS. Not verifiable is not not-valid, and the
       reader still gets the status and the tonnage. */
    expect(reply.params["status"]).toBe("issued");
    expect(reply.params["tonnes"]).toBe(1.05);
  });

  it("does not claim a credential checks out when it cannot tell", () => {
    withOrigin(undefined);
    const plan = planCreditStatus(slots());
    if (plan.status !== "read") throw new Error("expected a read");

    const reply = plan.reply([{ credit: credit() }]);
    expect(reply.key).toBe("assistant.credit.status_not_verifiable");
    expect(reply.params["reason"]).toBe("origin_unknown");
  });

  it("says so when there is no such credit", () => {
    const plan = planCreditStatus(slots());
    if (plan.status !== "read") throw new Error("expected a read");
    expect(plan.reply([undefined]).key).toBe("assistant.credit.not_found");
    expect(plan.reply([{}]).key).toBe("assistant.credit.not_found");
  });

  it("accepts a bare credit record as well as a wrapped one", () => {
    withOrigin(PUBLIC_ORIGIN);
    const plan = planCreditStatus(slots());
    if (plan.status !== "read") throw new Error("expected a read");
    expect(plan.reply([credit()]).key).toBe("assistant.credit.status");
  });

  for (const [label, jwt] of [
    ["a credential with no status entry", credentialNaming(null)],
    ["a credential that is not a JWT", "not-a-jwt"],
    ["an empty credential", ""],
  ] as const) {
    it(`treats ${label} as not verifiable rather than throwing`, () => {
      withOrigin(PUBLIC_ORIGIN);
      const plan = planCreditStatus(slots());
      if (plan.status !== "read") throw new Error("expected a read");
      expect(plan.reply([{ credit: credit({ credentialJwt: jwt }) }]).key).toBe(
        "assistant.credit.status_not_verifiable",
      );
    });
  }
});

describe("retire_credit", () => {
  it("proposes, naming which credit and as whom", () => {
    const plan = planRetire(slots());
    expect(plan.status).toBe("write");
    if (plan.status !== "write") return;

    expect(plan.summary.key).toBe("assistant.credit.retire_summary");
    expect(plan.summary.params).toMatchObject({ creditId: CREDIT_ID, retiredBy: "prod_bathinda" });
    expect(plan.call).toEqual({
      agent: "registry",
      skill: "retireCredit",
      input: { creditId: CREDIT_ID, retiredBy: "prod_bathinda", reason: "retired via Saathi" },
    });
  });

  it("reports what actually happened, in full, once it has", () => {
    const plan = planRetire(slots());
    if (plan.status !== "write") throw new Error("expected a write");

    const reply = plan.done({ credit: credit({ status: "retired" }) });
    expect(reply.key).toBe("assistant.credit.retired_detail");
    expect(reply.params).toMatchObject({ creditId: CREDIT_ID, tonnes: 1.05, holder: "prod_bathinda", status: "retired" });
  });

  it("still confirms something useful if the output cannot be read", () => {
    const plan = planRetire(slots());
    if (plan.status !== "write") throw new Error("expected a write");
    expect(plan.done(undefined).key).toBe("assistant.credit.retired");
  });

  it("asks for the credit id", () => {
    const plan = planRetire({ holder: "prod_bathinda" });
    expect(plan.status).toBe("need");
    if (plan.status === "need") expect(plan.reply.key).toBe("assistant.credit.retire_need_id");
  });

  it("asks who is retiring it", () => {
    const plan = planRetire({ creditId: CREDIT_ID });
    expect(plan.status).toBe("need");
    if (plan.status === "need") expect(plan.reply.key).toBe("assistant.credit.retire_need_holder");
  });

  it("refuses a malformed id before anything is called", () => {
    const plan = planRetire({ creditId: "crd_wrong", holder: "prod_bathinda" });
    expect(plan.status).toBe("need");
    if (plan.status === "need") expect(plan.reply.key).toBe("assistant.credit.malformed_id");
  });
});

/* ------------------------------------------------------------------ *
 * THE GUARANTEE.
 *
 * No input produces a plan that retires anything without going through the
 * planner's confirmation. A `write` is a proposal; only ../planner.ts spends
 * a token. So what this module must never do is return a retirement in a
 * `read`, which the planner dispatches immediately and without asking.
 *
 * Written to be able to fail: it sweeps inputs designed to look confirmed.
 * ------------------------------------------------------------------ */
describe("no input dispatches a retirement without confirmation", () => {
  const tokenish = "confirm_this_is_not_a_real_token";

  const inputs: Array<[string, AssistantSlots]> = [
    ["nothing at all", {}],
    ["a token in the credit id", { creditId: tokenish, holder: CREDIT.holder }],
    ["a token as the holder", { creditId: CREDIT_ID, holder: tokenish }],
    ["a token in every slot", { creditId: tokenish, holder: tokenish, taskId: tokenish, lotId: tokenish }],
    ["a complete, valid request", slots()],
    ["whitespace slots", { creditId: "   ", holder: "   " }],
    ["a holder that is empty", { creditId: CREDIT_ID, holder: "" }],
    ["an id with the right prefix and wrong body", { creditId: "crd_ZZZZZZZZZZZZZZZZZZZZ", holder: "x" }],
  ];

  for (const [label, s] of inputs) {
    it(`never returns a dispatchable retirement, given ${label}`, () => {
      const plan = planRetire(s);

      /* A `read` runs immediately. Nothing that retires may ever be in one. */
      if (plan.status === "read") {
        expect(plan.calls.some((c) => c.skill === "retireCredit")).toBe(false);
      }
      /* retireCredit appears only as the call of a write, which the planner
         will not make until a token bound to this intent comes back. */
      if (plan.status === "write") {
        expect(plan.call.skill).toBe("retireCredit");
      }
      expect(["need", "read", "write"]).toContain(plan.status);
    });
  }

  it("never dispatches a write from the read-only intent either", () => {
    for (const [, s] of inputs) {
      const plan = planCreditStatus(s);
      if (plan.status === "read") {
        expect(plan.calls.every((c) => c.skill === "lookupCredit")).toBe(true);
      }
      expect(plan.status).not.toBe("write");
    }
  });
});

describe("verifiabilityOf", () => {
  it("accepts a list on the public origin", () => {
    expect(verifiabilityOf(credit(), PUBLIC_ORIGIN)).toEqual({ verifiable: true, listHost: PUBLIC_ORIGIN });
  });

  it("compares origins, not whole URLs", () => {
    const withQuery = credit({ credentialJwt: credentialNaming(`${PUBLIC_ORIGIN}/status/credits?v=2`) });
    expect(verifiabilityOf(withQuery, PUBLIC_ORIGIN).verifiable).toBe(true);
  });

  it("rejects a docker-internal host", () => {
    const stale = credit({ credentialJwt: credentialNaming("http://registry:4004/status/credits") });
    expect(verifiabilityOf(stale, PUBLIC_ORIGIN)).toEqual({
      verifiable: false,
      reason: "unreachable_list",
      listHost: "http://registry:4004",
    });
  });

  it("fails closed when the deployment's own origin is unusable", () => {
    const check = verifiabilityOf(credit(), "not a url");
    expect(check.verifiable).toBe(false);
    if (!check.verifiable) expect(check.reason).toBe("origin_unknown");
  });
});
