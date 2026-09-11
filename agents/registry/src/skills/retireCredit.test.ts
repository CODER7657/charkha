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
    await retireCredit({ ...input, retiredBy: "someone-else" }, { ...ctx, taskId: "task_10" });
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
    await store.insertCredit({ ...CREDIT, creditId: "crd_2", evidenceId: "evi_2" }, "task_2");
    await retireCredit({ ...input, creditId: "crd_2" }, ctx);

    const payload = statusListCredentialPayload(await store.listCredits(), "did:key:z6MkTestIssuer");
    expect(bitAt(payload.credentialSubject.encodedList, 0)).toBe(0);
    expect(bitAt(payload.credentialSubject.encodedList, 1)).toBe(1);
  });

  it("encodes a list large enough for the spec's minimum", () => {
    const bytes = gunzipSync(Buffer.from(encodeStatusList([]), "base64url"));
    expect(bytes.length).toBe(16 * 1024);
  });

  it("refuses an index past the end of the list", () => {
    expect(() => encodeStatusList([16 * 1024 * 8])).toThrow(/out of range/);
  });
});
