import { describe, it, expect, beforeEach } from "vitest";
import { gunzipSync } from "node:zlib";
import type { CreditRecord } from "@charkha/core";
import { memoryStore } from "../memoryStore.ts";
import { encodeStatusList, statusListCredentialPayload } from "../statusList.ts";
import { makeRetireCredit } from "./retireCredit.ts";

/* Retirement is terminal and idempotent. If retiring twice appended two
   decisions, or errored, the ledger would tell a story that never happened. */

const CREDIT: CreditRecord = {
  creditId: "crd_1",
  matchId: "mat_1",
  evidenceId: "evi_1",
  netTonnesCo2e: 3.1,
  breakdown: { grossSequestrationTco2e: 4.0, transportDebitTco2e: 0.75, processDebitTco2e: 0.15 },
  issuedAt: "2026-09-02T10:00:00.000Z",
  status: "issued",
  credentialJwt: "jwt.goes.here",
  credentialId: "urn:charkha:credential:crd_1",
  issuerDid: "did:key:z6MkTestIssuer",
  holder: "acme-offtaker",
  statusListIndex: 0,
};

const ctx = { taskId: "task_9", contextId: "ctx_9", progress: () => {} };
const input = { creditId: "crd_1", retiredBy: "acme-offtaker", reason: "voluntary retirement" };

let store: ReturnType<typeof memoryStore>;
let retireCredit: ReturnType<typeof makeRetireCredit>;

beforeEach(async () => {
  store = memoryStore();
  await store.insertCredit(CREDIT, "task_1");
  retireCredit = makeRetireCredit(store);
});

describe("retirement", () => {
  it("flips the credit to retired", async () => {
    const { credit } = await retireCredit(input, ctx);
    expect(credit.status).toBe("retired");
    expect(store.credits[0]!.status).toBe("retired");
  });

  it("appends exactly one decision", async () => {
    await retireCredit(input, ctx);
    expect(store.decisions).toHaveLength(1);
    expect(store.decisions[0]).toMatchObject({ agent: "registry", action: "retireCredit", taskId: "task_9" });
  });

  it("refuses a credit that does not exist", async () => {
    await expect(retireCredit({ ...input, creditId: "crd_nope" }, ctx)).rejects.toThrow(/crd_nope/);
    expect(store.decisions).toHaveLength(0);
  });
});

describe("idempotency", () => {
  it("returns the same record on a second retirement, without erroring", async () => {
    const first = await retireCredit(input, ctx);
    const second = await retireCredit(input, ctx);
    expect(second.credit).toEqual(first.credit);
  });

  it("does not append a second decision", async () => {
    await retireCredit(input, ctx);
    await retireCredit(input, ctx);
    // Was a third call from a different caller. Since the holder check landed,
    // that is a refusal rather than a quiet no-op, and it is asserted as such
    // in "only the holder can retire". The point here is unchanged: repeated
    // retirement must not make the ledger claim it happened twice.
    await retireCredit(input, { ...ctx, taskId: "task_10" });
    expect(store.decisions).toHaveLength(1);
  });
});

describe("status list", () => {
  const bitAt = (encodedList: string, index: number): number => {
    const bytes = gunzipSync(Buffer.from(encodedList, "base64url"));
    return (bytes[index >>> 3]! >>> (7 - (index & 7))) & 1;
  };

  it("sets no bits while everything is live", () => {
    const payload = statusListCredentialPayload([CREDIT], "did:key:z6MkTestIssuer");
    expect(bitAt(payload.credentialSubject.encodedList, 0)).toBe(0);
  });

  it("sets exactly the retired credit's bit", async () => {
    // Distinct index: the database's unique constraint forbids two credits
    // sharing one, and the bit a holder checks is the credential's own index.
    await store.insertCredit({ ...CREDIT, creditId: "crd_2", evidenceId: "evi_2", statusListIndex: 1 }, "task_2");
    await retireCredit({ ...input, creditId: "crd_2" }, ctx);

    const payload = statusListCredentialPayload(await store.listCredits(), "did:key:z6MkTestIssuer");
    expect(bitAt(payload.credentialSubject.encodedList, 0)).toBe(0);
    expect(bitAt(payload.credentialSubject.encodedList, 1)).toBe(1);
  });

  /**
   * The one that matters. Indices come from a database sequence, so they stop
   * matching array position the moment anything is issued out of order, in
   * parallel, or after a refusal burned a sequence value - which is the normal
   * case, not the exotic one.
   *
   * A holder checks the bit their OWN credential points at. If the list is
   * built from position instead, a retired credit reads as live, under our own
   * signature - the exact double-sale the status list exists to prevent.
   */
  it("sets the bit the credential commits to, not the row's position", () => {
    const live = { ...CREDIT, creditId: "crd_a", evidenceId: "evi_a", statusListIndex: 5 };
    const retired = {
      ...CREDIT,
      creditId: "crd_b",
      evidenceId: "evi_b",
      statusListIndex: 9,
      status: "retired" as const,
    };

    const { encodedList } = statusListCredentialPayload([live, retired], "did:key:z6MkTestIssuer").credentialSubject;

    expect(bitAt(encodedList, 9)).toBe(1); // the retired credit's own index
    expect(bitAt(encodedList, 5)).toBe(0); // the live one's index
    expect(bitAt(encodedList, 1)).toBe(0); // its position in the array, which means nothing
  });

  it("encodes a list large enough for the spec's minimum", () => {
    const bytes = gunzipSync(Buffer.from(encodeStatusList([]), "base64url"));
    expect(bytes.length).toBe(16 * 1024);
  });

  it("refuses an index past the end of the list", () => {
    expect(() => encodeStatusList([16 * 1024 * 8])).toThrow(/out of range/);
  });
});

/* ------------------------------------------------------------------ *
 * The holder check.
 *
 * Credit ids are not secret: GET /api/ledger and GET /api/trace/:taskId are
 * unauthenticated, so two requests enumerate every credit in the system.
 * Retirement is terminal and globally visible. Without an owner, anyone could
 * permanently retire all of them.
 * ------------------------------------------------------------------ */
describe("only the holder can retire", () => {
  it("refuses when retiredBy is not the holder", async () => {
    await expect(retireCredit({ ...input, retiredBy: "someone-else" }, ctx)).rejects.toThrow(
      /does not match the credit's holder/,
    );
  });

  it("appends no decision for a refused retirement", async () => {
    const before = store.decisions.length;
    await expect(retireCredit({ ...input, retiredBy: "someone-else" }, ctx)).rejects.toThrow();
    expect(store.decisions.length).toBe(before);
  });

  it("leaves the credit issued after a refused retirement", async () => {
    await expect(retireCredit({ ...input, retiredBy: "someone-else" }, ctx)).rejects.toThrow();
    const after = await store.findCreditById("crd_1");
    expect(after?.status).toBe("issued");
  });

  /* Checked before the idempotent early return on purpose: a wrong caller must
     not be able to learn whether a credit is already retired either. */
  it("refuses a wrong holder even once the credit is retired", async () => {
    await retireCredit(input, ctx);
    await expect(retireCredit({ ...input, retiredBy: "someone-else" }, ctx)).rejects.toThrow(
      /does not match the credit's holder/,
    );
  });
});
