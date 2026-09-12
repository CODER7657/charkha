import { useCallback, useEffect, useState } from "react";
import type { DecisionRecord, TraceBundle } from "@charkha/core";
import {
  ATTACKS,
  NOT_FROM_BROWSER,
  duplicatePhotoPayload,
  forgedVerdictPayload,
  haveBothTargets,
  judgeHttp,
  judgeTamper,
  MAX_TRACE_FETCHES,
  orderTaskIds,
  pickTargets,
  tamperAt,
  verifyHere,
  type Attack,
  type AttackId,
  type HttpResult,
  type Outcome,
  type Targets,
} from "./breakit/attacks.ts";
import "./breakit/breakit.css";

/**
 * OWNER: Harsh
 *
 * Break It - six attacks a judge can run against the live API.
 *
 * Every guard in this system is invisible. We spent the project building
 * them - a photograph that cannot be credited twice, a verdict that cannot be
 * forged, an agent call that cannot be made without a token, a ledger row that
 * cannot be edited without the chain saying so - and a judge looking at the
 * deployed site sees a green dashboard, which is indistinguishable from a CRUD
 * app with good CSS.
 *
 * So: real requests, real status codes, real refusal text, shown raw. Nothing
 * simulated. If any of it were faked the screen would be worth less than
 * nothing, because the entire claim it makes is that it is not theatre.
 *
 * Three things this screen will not do:
 *
 *   - it does not use api.ts, which throws on a non-2xx and discards the body.
 *     A refusal IS the payload here.
 *   - it never writes. The two attacks that reach a write endpoint are refused
 *     by definition, which is the point; the tamper demo edits a copy of the
 *     chain in memory and never goes near decision_log.
 *   - it never paints an attempt green unless it was actually refused. An
 *     attack that succeeds renders as a failure, and an attack that could not
 *     be run renders as neither.
 */

/** Raw fetch. Deliberately not api.ts - a non-2xx is the result, not an error. */
const attempt = async (path: string, init?: RequestInit): Promise<HttpResult> => {
  try {
    const res = await fetch(path, {
      ...init,
      headers: init?.body ? { "content-type": "application/json", ...init?.headers } : init?.headers,
    });
    return { ok: true, status: res.status, body: await res.text() };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
};

type Result = { outcome: Outcome; raw: string };
type Results = Partial<Record<AttackId, Result>>;

/** Pretty-print a JSON body, and leave anything that is not JSON alone. */
const readable = (body: string): string => {
  try {
    return JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    return body;
  }
};

const rawOf = (result: HttpResult): string =>
  result.ok ? `HTTP ${result.status}\n\n${readable(result.body)}` : `no response\n\n${result.error}`;

export const BreakItView = () => {
  const [chain, setChain] = useState<DecisionRecord[]>([]);
  const [targets, setTargets] = useState<Targets>({ credited: null, refused: null });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [results, setResults] = useState<Results>({});
  const [running, setRunning] = useState<AttackId | null>(null);

  /* Nothing is hard-coded. The screen reads the live ledger, follows task ids
     into traces, and attacks whatever it actually finds - so it keeps working
     after the database is reset, and a judge can see the ids came from the
     system rather than from us. */
  const discover = useCallback(async () => {
    setLoading(true);
    setLoadError(null);

    const ledger = await attempt("/api/ledger");
    if (!ledger.ok || ledger.status !== 200) {
      setLoadError(ledger.ok ? `ledger returned HTTP ${ledger.status}` : ledger.error);
      setLoading(false);
      return;
    }

    const { chain: records } = JSON.parse(ledger.body) as { chain: DecisionRecord[] };
    setChain(records);

    /* Newest first WITHIN each shape - credited and refused are different
       populations and taking the twelve most recent of both together starved
       the refused one. See orderTaskIds. */
    const taskIds = orderTaskIds(records);

    const bundles: TraceBundle[] = [];
    for (const taskId of taskIds.slice(0, MAX_TRACE_FETCHES)) {
      const res = await attempt(`/api/trace/${encodeURIComponent(taskId)}`);
      if (res.ok && res.status === 200) bundles.push(JSON.parse(res.body) as TraceBundle);
      /* Stop as soon as both targets exist - on a healthy ledger that is two
         or three fetches, and the bound above only matters when one of the
         two genuinely does not exist yet. */
      if (haveBothTargets(pickTargets(bundles))) break;
    }

    setTargets(pickTargets(bundles));
    setLoading(false);
  }, []);

  useEffect(() => {
    void discover();
  }, [discover]);

  const record = (id: AttackId, outcome: Outcome, raw: string) =>
    setResults((prev) => ({ ...prev, [id]: { outcome, raw } }));

  const run = async (attack: Attack) => {
    setRunning(attack.id);
    try {
      if (attack.id === "tamper_ledger") return runTamper();

      const call = plan(attack.id, targets);
      if (call === null) {
        record(attack.id, { state: "unknown", detail: "Nothing on the live system to attack yet." }, "not run");
        return;
      }

      const result = await attempt(call.path, { method: "POST", body: JSON.stringify(call.body) });
      const outcome = judgeHttp(result, attack.expect ?? 400);
      /* A caveat qualifies WHAT was proved; it never softens the verdict. An
         attack that succeeded is still `broken` and still loud. */
      record(
        attack.id,
        call.caveat ? { ...outcome, detail: `${outcome.detail} ${call.caveat}` } : outcome,
        rawOf(result),
      );
    } finally {
      setRunning(null);
    }
  };

  /* Client-side, always. Rule 5 says a decision_log row is never updated, and
     a demo is not an exception - so the chain is edited on a copy, in memory,
     and re-verified with the same verifyChain the server runs. */
  const runTamper = () => {
    if (chain.length === 0) {
      record("tamper_ledger", { state: "unknown", detail: "No ledger to edit." }, "not run");
      return;
    }

    const target = chain[Math.floor(chain.length / 2)]!;
    const before = verifyHere(chain);
    const edited = tamperAt(chain, target.seq, "action", `${target.action}_edited`);
    const after = verifyHere(edited);

    record(
      "tamper_ledger",
      judgeTamper(before, after, target.seq),
      [
        `edited  seq ${target.seq}  action: "${target.action}" -> "${target.action}_edited"`,
        ``,
        `before  ${before.valid ? "valid" : `BROKEN at seq ${before.brokenAtSeq}`}  (${before.length} records)`,
        `after   ${after.valid ? "valid" : `BROKEN at seq ${after.brokenAtSeq}`}  (${after.length} records)`,
        after.valid ? "" : `reason  ${after.reason}`,
        ``,
        `Nothing was written. The edit happened in this browser.`,
      ].join("\n"),
    );
  };

  return (
    <div className="view breakit">
      <div className="view-head">
        <h2>Break It</h2>
        <p>
          Six attacks against the live API. Every request below is real, and so is every refusal — the
          status code and the response body are shown exactly as they came back.
        </p>
      </div>

      <p className="bi-legend">
        <span className="bi-chip held">held</span> the guard refused, which is the result we want ·{" "}
        <span className="bi-chip broken">broke</span> the attack worked, which is a real failure ·{" "}
        <span className="bi-chip unknown">not proved</span> it could not be run
      </p>

      {loading ? <p className="bi-status">Finding a real credit on the live system to attack…</p> : null}
      {loadError ? (
        <p className="bi-status bi-err">
          Could not read the ledger: {loadError}. The attacks below will say so rather than guessing.
        </p>
      ) : null}
      {!loading && !loadError && targets.credited === null ? (
        <p className="bi-status bi-err">
          No credit has been issued on this system yet, so there is nothing to double-credit. Issue one from
          the Field and Audit screens first.
        </p>
      ) : null}

      <ol className="bi-list">
        {ATTACKS.map((attack, i) => {
          const blocked = NOT_FROM_BROWSER[attack.id];
          const result = results[attack.id];
          const state = blocked ? "unknown" : (result?.outcome.state ?? "idle");

          return (
            <li key={attack.id} className={`bi-row ${state}`}>
              <div className="bi-head">
                <span className="bi-n">{i + 1}</span>
                <h3>{attack.title}</h3>
                {result ? <span className={`bi-chip ${result.outcome.state}`}>{LABEL[result.outcome.state]}</span> : null}
                {blocked ? <span className="bi-chip unknown">{LABEL.unknown}</span> : null}
              </div>

              <p className="bi-tries">{attack.tries}</p>
              <p className="bi-guard">{attack.guard}</p>

              {blocked ? (
                <>
                  <p className="bi-blocked">{blocked.because}</p>
                  <pre className="bi-raw">{blocked.instead}</pre>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className="bi-run"
                    disabled={loading || running !== null}
                    onClick={() => void run(attack)}
                  >
                    {running === attack.id ? "Trying…" : "Try it"}
                  </button>
                  {result ? (
                    <>
                      <p className="bi-detail">{result.outcome.detail}</p>
                      <pre className="bi-raw">{result.raw}</pre>
                    </>
                  ) : null}
                </>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
};

const LABEL = { held: "refused", broken: "IT WORKED", unknown: "not proved" } as const;

/** Which request each attack sends, against whatever the screen found to attack. */
const plan = (
  id: AttackId,
  targets: Targets,
): { path: string; body: unknown; caveat?: string } | null => {
  const { credited, refused } = targets;

  if (id === "double_credit") {
    return credited === null
      ? null
      : { path: "/api/credits/issue", body: { matchId: credited.matchId, evidenceId: credited.evidenceId } };
  }

  if (id === "forged_verdict") {
    /* A batch the verifier REFUSED is the sharper target: we send "accepted"
       and the registry answers with the verdict it actually holds. Against an
       already-credited batch the refusal is about the credit instead, which
       proves the field was ignored but says nothing about where the verdict
       came from. Either way the verdict we send is never read. */
    const target = refused ?? credited;
    if (target === null) return null;
    return {
      path: "/api/credits/issue",
      body: forgedVerdictPayload(target.matchId, target.evidenceId),
      /* Say which target we got, on screen, not only in this comment.
      
         With no refused batch on the system the fallback is not an edge case,
         it is what a judge sees - and they read "Supply our own verdict",
         then a refusal that says "already been credited". Both sentences are
         true and together they look like an overclaim, which on this screen
         is the worst possible failure: its whole value is that it is not
         theatre. Ayush caught this against the live API. */
      ...(refused === null
        ? {
            caveat:
              "No refused batch exists on this system, so this attacked an already-credited one. That proves the verdict we sent was ignored - it does not show the registry reading the verdict it holds. Capture a needs_review photo on the Field screen and run this again to see that.",
          }
        : {}),
    };
  }

  if (id === "same_photo") {
    return credited === null
      ? null
      : {
          path: "/api/evidence",
          body: duplicatePhotoPayload(credited.evidence, `ev_breakit_${Date.now().toString(36)}`),
        };
  }

  return null;
};
