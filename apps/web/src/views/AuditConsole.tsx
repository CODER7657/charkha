import { useEffect, useState } from "react";
import { api } from "../api.ts";

/**
 * OWNER: Ayush
 *
 * THE WOW SCREEN. Spend your polish budget here - this is what is on screen
 * during the credential half of the pitch.
 *
 * BUILD
 *  - the hash chain as a vertical list: seq, agent, action, confidence,
 *    model hash (truncated, click to copy), and the link to the previous
 *    record. Mark the chain verdict at the top: VALID / BROKEN AT seq N.
 *  - a "verify chain" button that re-derives every hash client-side and
 *    shows the result. Do not just print what the server told you - the
 *    point is that anyone can check it.
 *  - a TAMPER DEMO control: fetch the chain, let the judge edit one field in
 *    the UI, re-run verification, watch it go red at exactly that seq. This
 *    is a 20-second demo beat that lands harder than any slide.
 *  - the credential panel: decoded VC claims, issuer DID, status
 *    (issued / retired), and a "verify signature" action that actually
 *    verifies rather than trusting our database
 *  - a task-id lookup box: paste an A2A task id, get evidence to decision to
 *    credential in one thread (GET /api/trace/:taskId)
 *
 * Import verifyChain from @charkha/core and run it in the browser - the same
 * function the server uses. One implementation, two places.
 */
export const AuditConsole = () => {
  const [state, setState] = useState<{ chain: unknown[]; verdict: { valid: boolean } } | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    api
      .ledger()
      .then(setState)
      .catch((e: unknown) => setErr(e instanceof Error ? e.message : String(e)));
  }, []);

  const summary = state
    ? state.chain.length + " records, chain " + (state.verdict.valid ? "valid" : "BROKEN")
    : "loading ledger...";

  return (
    <div className="view">
      <div className="view-head">
        <h1>Audit</h1>
        <p>Every decision, hash-chained. Tamper with one and the chain says exactly where.</p>
      </div>
      {err ? <p className="muted">{err}</p> : null}
      <p className="muted">{summary}</p>
      <div className="placeholder">TODO(ayush): chain view + tamper demo + credential panel + task lookup</div>
    </div>
  );
};
