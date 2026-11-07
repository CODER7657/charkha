import type { ChainVerdict, DecisionRecord, FieldEvidence, TraceBundle } from "@charkha/core";
import { verifyChain } from "@charkha/core";

/* ------------------------------------------------------------------ *
 * OWNER: Harsh
 *
 * Break It - the pure half.
 *
 * Every refusal this system makes is invisible. A judge looking at the
 * deployed site sees a green dashboard, which is indistinguishable from a
 * CRUD app with good CSS. This screen fires real requests at the real API and
 * shows the real status code and the real refusal text.
 *
 * Nothing here fetches. The view does the I/O and hands the results to these
 * functions, which decide what actually happened - because the one branch
 * that matters most is the one that almost never fires, and it has to be
 * testable without a server that is willing to be broken.
 *
 * THE RULE THIS FILE EXISTS TO ENFORCE: an attempt that SUCCEEDS is a
 * failure, and must be rendered as one. A screen that quietly showed green
 * for an attack that worked would be worse than no screen at all.
 * ------------------------------------------------------------------ */

export type AttackId =
  | "double_credit"
  | "forged_verdict"
  | "no_token"
  | "edited_token"
  | "same_photo"
  | "tamper_ledger";

/**
 * What happened when we tried.
 *
 * Three states and not two, because "we could not run it" is not the same as
 * "it refused us" and must never be painted as one. The names are the point:
 * `held` is the guard doing its job, `broken` is the attack working.
 */
export type OutcomeState = "held" | "broken" | "unknown";

export type Outcome = {
  state: OutcomeState;
  /** One line a judge can read. Never the raw body - that is shown separately. */
  detail: string;
};

export type Attack = {
  id: AttackId;
  /** What a judge reads before pressing. They should understand the attack from this. */
  title: string;
  /** The attempt, in one sentence. */
  tries: string;
  /** Why it must fail, in one sentence. */
  guard: string;
  /** The status code a correct refusal carries, when this attack makes an HTTP call. */
  expect: number | null;
};

export const ATTACKS: readonly Attack[] = [
  {
    id: "double_credit",
    title: "Credit the same batch twice",
    tries: "Ask the registry to issue a second credit for a batch of evidence that already has one.",
    guard: "Double counting is the failure a carbon registry exists to prevent, and the first thing an auditor tries.",
    expect: 400,
  },
  {
    id: "forged_verdict",
    title: "Supply our own verdict",
    tries: "Ask for a credit while attaching a verdict of accepted and a perfect quality score.",
    guard:
      "IssueCreditInput cannot express a verdict at all. The registry reads it from the row the verifier wrote, so the one we send is not merely rejected - it is never read.",
    expect: 400,
  },
  {
    id: "no_token",
    title: "Call an agent with no bearer token",
    tries: "Invoke a skill directly on an agent, with no Authorization header.",
    guard: "Every agent refuses an unauthenticated /a2a call before the protocol handler sees it.",
    expect: 401,
  },
  {
    id: "edited_token",
    title: "Edit a token after it was signed",
    tries: "Take a valid agent token, change who it claims to be, and present it.",
    guard: "The signature covers the claims, so changing sub invalidates it.",
    expect: 401,
  },
  {
    id: "same_photo",
    title: "Submit one photograph twice",
    tries: "Resubmit a photograph that has already been credited, under a brand new evidence id.",
    guard:
      "One pile photographed once and submitted against five matches used to produce five credits, and nothing in the chain noticed. A unique index on the image hash is what actually stops it.",
    expect: 400,
  },
  {
    id: "tamper_ledger",
    title: "Edit a row in the ledger",
    tries: "Change one field of one decision record and re-verify the hash chain.",
    guard: "Each record hashes onto the one before it, so an edit anywhere breaks every link after it.",
    expect: null,
  },
];

/* ------------------------------------------------------------------ *
 * Two of the six cannot be fired from this page, and pretending otherwise
 * would be the one thing that makes the whole screen worthless.
 *
 * An agent is never exposed: only 80 and 443 are open on the VM and Caddy
 * proxies the gateway alone, so `http://producer:4001/a2a` does not exist
 * from a browser. This page's own Content-Security-Policy then says
 * `connect-src 'self'`, so it could not reach one even if it did.
 *
 * That is not a gap in the guard - it is a second guard in front of it, and
 * saying so is a stronger claim than a 401 would have been. What it is NOT is
 * a demonstration, so these two rows never render as a pass. The command that
 * does demonstrate them is shown instead, to be run on the box.
 * ------------------------------------------------------------------ */

export const NOT_FROM_BROWSER: Partial<Record<AttackId, { because: string; instead: string }>> = {
  no_token: {
    because:
      "Agents are not reachable from a browser. Only 80 and 443 are open on the VM, Caddy proxies the gateway alone, and this page may only connect to its own origin.",
    instead: `curl -si -X POST http://producer:4001/a2a -H 'content-type: application/json' -d '{}'`,
  },
  edited_token: {
    because:
      "Same reason. The signature is verified before the protocol handler sees the request, so any token whose claims were changed after signing fails the same way.",
    instead: `curl -si -X POST http://producer:4001/a2a -H 'authorization: Bearer <valid token with sub edited>' -d '{}'`,
  },
};

/* ------------------------------------------------------------------ *
 * Judging an HTTP attempt.
 * ------------------------------------------------------------------ */

export type HttpResult =
  | { ok: true; status: number; body: string }
  /** The request never completed - offline, DNS, CORS, the box is down. */
  | { ok: false; error: string };

/**
 * Did the guard hold?
 *
 * The 2xx branch is the reason this function exists. It will almost never
 * fire, which is exactly why it is written first and tested directly: the
 * expensive failure is not an attack that works, it is an attack that works
 * and is painted green.
 */
export const judgeHttp = (result: HttpResult, expected: number): Outcome => {
  if (!result.ok) {
    /* Not a pass. A screen about refusals must not fall over when the network
       does, and it must not claim a refusal it never received either. */
    return { state: "unknown", detail: `Could not reach the API - ${result.error}. Nothing was proved either way.` };
  }

  if (result.status >= 200 && result.status < 300) {
    return {
      state: "broken",
      detail: `The API ACCEPTED this (HTTP ${result.status}). It should have refused. This is a real failure - tell the team.`,
    };
  }

  if (result.status === expected) {
    return { state: "held", detail: `Refused with HTTP ${result.status}, as it should be.` };
  }

  /* A guard that refuses with a 500 is still a guard, but it is reporting
     itself as an outage - the exact drift the gateway's caller-error
     classifier exists to prevent. Worth saying out loud rather than passing. */
  if (result.status >= 500) {
    return {
      state: "unknown",
      detail: `Refused, but as a server fault (HTTP ${result.status}) rather than a bad request. The guard may be working and reporting itself as an outage.`,
    };
  }

  return {
    state: "held",
    detail: `Refused with HTTP ${result.status}. Expected ${expected}, so the refusal is real but not the one described.`,
  };
};

/* ------------------------------------------------------------------ *
 * Judging the tamper demo.
 *
 * Entirely client-side. The chain is fetched, edited IN MEMORY and re-verified
 * with the same verifyChain the server runs. Nothing is written: rule 5 says a
 * decision_log row is never updated, and a demo is not an exception.
 * ------------------------------------------------------------------ */

export type TamperField = "action" | "confidence";

/** Return a copy of the chain with one field of one record changed. */
export const tamperAt = (
  chain: readonly DecisionRecord[],
  seq: number,
  field: TamperField,
  value: string,
): DecisionRecord[] =>
  chain.map((rec) =>
    rec.seq === seq
      ? field === "confidence"
        ? { ...rec, confidence: value === "" ? null : Number(value) }
        : { ...rec, action: value }
      : { ...rec },
  );

/**
 * The guarantee is not "the chain goes red". It is "the chain goes red **at
 * the row that was edited**" - a chain that broke somewhere else would mean
 * the linkage does not say what we claim it says.
 */
export const judgeTamper = (before: ChainVerdict, after: ChainVerdict, editedSeq: number): Outcome => {
  if (!before.valid) {
    return {
      state: "unknown",
      detail: `The chain was already invalid before we touched it (at seq ${before.brokenAtSeq ?? "?"}), so this proves nothing.`,
    };
  }
  if (after.valid) {
    return {
      state: "broken",
      detail: "The chain still verifies after an edit. Tamper-evidence is not working - this is a real failure.",
    };
  }
  if (after.brokenAtSeq !== editedSeq) {
    return {
      state: "unknown",
      detail: `The chain broke at seq ${after.brokenAtSeq ?? "?"}, but we edited seq ${editedSeq}. It noticed something, but not the thing we did.`,
    };
  }
  return {
    state: "held",
    detail: `Broken at seq ${editedSeq}, exactly where the edit was made. Every record after it is orphaned.`,
  };
};

/** Verify a chain the way the server does. Exported so the view does one import. */
export const verifyHere = (chain: readonly DecisionRecord[]): ChainVerdict => verifyChain(chain);

/* ------------------------------------------------------------------ *
 * Finding something real to attack.
 *
 * Nothing is hard-coded. The screen reads the live ledger, follows task ids
 * into traces, and attacks whatever it actually finds - so it keeps working
 * after the database is reset, and a judge can see that the ids came from the
 * system rather than from us.
 * ------------------------------------------------------------------ */

export type Targets = {
  /** A batch that already holds a credit. Attacks 1, 2 and 5 need one. */
  credited: { matchId: string; evidenceId: string; creditId: string; evidence: FieldEvidence } | null;
  /**
   * A batch the verifier refused. Attack 2 is far sharper against one of
   * these: we send "accepted", the registry reports the stored verdict, and
   * the two do not match.
   */
  refused: { matchId: string; evidenceId: string; verdict: string } | null;
};

export const pickTargets = (bundles: readonly TraceBundle[]): Targets => {
  const targets: Targets = { credited: null, refused: null };

  for (const b of bundles) {
    if (
      targets.credited === null &&
      b.credit !== null &&
      b.evidence !== null &&
      b.match !== null &&
      /* Retired and revoked credits still prove the point - the guard is
         "this evidence already has a credit", not "it has a live one". */
      b.credit.evidenceId === b.evidence.evidenceId
    ) {
      targets.credited = {
        matchId: b.match.matchId,
        evidenceId: b.evidence.evidenceId,
        creditId: b.credit.creditId,
        evidence: b.evidence,
      };
    }

    if (
      targets.refused === null &&
      b.credit === null &&
      b.match !== null &&
      b.verification !== null &&
      b.verification.verdict !== "accepted"
    ) {
      targets.refused = {
        matchId: b.match.matchId,
        evidenceId: b.verification.evidenceId,
        verdict: b.verification.verdict,
      };
    }

    if (targets.credited !== null && targets.refused !== null) break;
  }

  return targets;
};

/**
 * The same photograph, under a new evidence id.
 *
 * Everything else is copied verbatim from a submission that was already
 * credited - the hash, the model, the scores, the batch. That is the attack:
 * a field worker with one good photo and five matches to claim against.
 *
 * The id is passed in rather than generated here so this stays pure and the
 * test can assert on it.
 */
export const duplicatePhotoPayload = (evidence: FieldEvidence, newEvidenceId: string): FieldEvidence => ({
  ...evidence,
  evidenceId: newEvidenceId,
});

/** The credit request, with a verdict attached that the contract cannot carry. */
export const forgedVerdictPayload = (matchId: string, evidenceId: string): Record<string, unknown> => ({
  matchId,
  evidenceId,
  verdict: "accepted",
  charQualityScore: 1,
  confidence: 1,
  reasons: ["looks fine to me"],
});

/* ------------------------------------------------------------------ *
 * Which traces to fetch, and in what order.
 *
 * This screen used to take the twelve most recent verify/issue task ids and
 * hope a usable target was among them. Hem found what that costs (#90): a
 * perfectly good refused batch sat at seq 13 against a ledger of 141, matched
 * every clause of pickTargets, and was never looked at. Attack 2 then fell
 * back to an already-credited batch and honestly reported that it had proved
 * a weaker guard than the one the row claims to test.
 *
 * Recency is the wrong axis. What the screen needs is one credited batch and
 * one REFUSED batch, and those are different populations - a refused batch is
 * by definition one that never became a credit, so the newer the ledger gets,
 * the further a refused batch falls behind a wall of credited ones.
 *
 * So: split the tasks by what the ledger says happened in them, and take from
 * both queues. A task that verified evidence and never issued a credit is the
 * shape of a refusal; a task that issued one is the shape of a credit. Both
 * are still ordered newest-first within their own queue, so the most recent
 * example of each wins - which is what the original comment actually wanted.
 * ------------------------------------------------------------------ */

/** How many traces we are willing to fetch. A bound, not a target - the caller stops early once both targets are found. */
export const MAX_TRACE_FETCHES = 24;

type TaskShaped = { taskId: string; action: string };

export const orderTaskIds = (records: readonly TaskShaped[]): string[] => {
  /* What each task did, in ledger order. */
  const actions = new Map<string, Set<string>>();
  for (const r of records) {
    const set = actions.get(r.taskId) ?? new Set<string>();
    set.add(r.action);
    actions.set(r.taskId, set);
  }

  const ids = [...actions.keys()].reverse(); // newest first
  const credited: string[] = [];
  const refused: string[] = [];

  for (const id of ids) {
    const did = actions.get(id)!;
    if (did.has("issueCredit")) credited.push(id);
    else if (did.has("verifyEvidence")) refused.push(id);
  }

  /* Interleave rather than concatenate. Either queue can be empty on a fresh
     database, and whichever is shorter must not be starved by the other. */
  const out: string[] = [];
  for (let i = 0; i < Math.max(credited.length, refused.length); i++) {
    if (i < refused.length) out.push(refused[i]!);
    if (i < credited.length) out.push(credited[i]!);
  }
  return out;
};

/** True once there is nothing further to gain by fetching more traces. */
export const haveBothTargets = (t: Targets): boolean => t.credited !== null && t.refused !== null;
