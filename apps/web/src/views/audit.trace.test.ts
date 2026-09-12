import { describe, expect, it } from "vitest";
import { explainTraceFailure } from "./AuditConsole.tsx";

/* ------------------------------------------------------------------ *
 * What a failed trace lookup says.
 *
 * Reported from the deployed host: pasting into the credential panel gave
 *
 *   /trace/f7654afa%E2%80%A6bc7 -> HTTP 404
 *
 * which names the symptom and none of the three causes. The %E2%80%A6 is an
 * ellipsis: the decision log abbreviates every id on screen, so the obvious
 * thing to copy is exactly the thing that cannot work.
 *
 * A second report pasted a full, real uuid and also got 404 - that one was a
 * Saathi hop. listLots never calls appendDecision, so its task id is real and
 * untraceable at the same time, and nothing said so.
 * ------------------------------------------------------------------ */

const notFound = new Error("/api/trace/x -> HTTP 404");

describe("explaining a failed trace", () => {
  it.each([
    "f7654afa\u20264bc7",
    "f7654afa...4bc7",
    "8aafbde9\u2026e8a7",
  ])("recognises a shortened id copied off the screen: %s", (id) => {
    const msg = explainTraceFailure(id, notFound);
    expect(msg).toMatch(/shortened/i);
    expect(msg).toMatch(/Trace/);
  });

  /* The full uuid case. It is a real task id, it just belongs to a read. */
  it("explains that reads are not in the ledger", () => {
    const msg = explainTraceFailure("ae35c146-43dc-4c3b-b39f-9f1f1319aa65", notFound);
    expect(msg).toMatch(/do not write to the ledger/i);
    expect(msg).not.toMatch(/shortened/i);
  });

  /* Never swallow a failure that is not a 404 - a 500 or an offline gateway
     must still reach the reader as itself. */
  it.each([
    new Error("/api/trace/x -> HTTP 500"),
    new Error("Failed to fetch"),
  ])("passes a non-404 through unchanged: %s", (err) => {
    expect(explainTraceFailure("ae35c146-43dc-4c3b-b39f-9f1f1319aa65", err)).toBe((err as Error).message);
  });

  it("never renders a raw URL at the reader on a 404", () => {
    for (const id of ["f7654afa\u20264bc7", "ae35c146-43dc-4c3b-b39f-9f1f1319aa65"]) {
      expect(explainTraceFailure(id, notFound)).not.toMatch(/HTTP 404|\/api\/trace/);
    }
  });
});
