import type { CreditRecord } from "@charkha/core";
import { msg, type Plan, type Planner } from "./types.ts";

/* ------------------------------------------------------------------ *
 * OWNER: Ayush
 *
 * Credits, through a conversation.
 *
 *   credit_status   read  - is it live, what is it worth, can it be checked
 *   retire_credit   write - proposes; the planner performs, and only on a
 *                           confirmation bound to this intent and these slots
 *
 * The interesting judgement here is not the retirement. It is that
 * `credit_status` has to separate two claims that every other system
 * conflates: whether a credential's signature verifies, and whether the
 * person holding it can check that for themselves. On the deployed host
 * those already disagree - every credential minted before the status list
 * moved to the public origin names `http://registry:4004`, a hostname no
 * holder can resolve. Those credentials verify. They are not verifiable.
 *
 * Saathi is where someone who has never heard of a status list meets that
 * difference, so it is said in one sentence they can act on.
 * ------------------------------------------------------------------ */

/** `newId("crd")` shape. A typo gets asked about, not sent to the registry. */
const CREDIT_ID = /^crd_[0-9a-f]{20}$/;

/** What `registry.lookupCredit` is expected to return. See the note in the PR. */
type LookupOutput = { credit?: CreditRecord } | CreditRecord | undefined;

const creditOf = (outputs: unknown[]): CreditRecord | null => {
  const first = outputs[0] as LookupOutput;
  if (!first) return null;
  const credit = (first as { credit?: CreditRecord }).credit ?? (first as CreditRecord);
  return credit && typeof (credit as CreditRecord).creditId === "string" ? (credit as CreditRecord) : null;
};

/* ---------- verifiable is not the same as valid ---------- */

export type Verifiability =
  | { verifiable: true; listHost: string }
  /** A machine token, never prose - the client writes the sentence. */
  | {
      verifiable: false;
      reason: "no_credential" | "no_status_entry" | "unreachable_list" | "origin_unknown";
      listHost: string | null;
    };

/** The `credentialStatus.statusListCredential` a credential names, or null. Decoding is not verifying. */
const statusListUrlOf = (jwt: string): string | null => {
  const segments = jwt.split(".");
  if (segments.length !== 3) return null;
  try {
    const payload = JSON.parse(Buffer.from(segments[1]!, "base64url").toString()) as {
      vc?: { credentialStatus?: { statusListCredential?: unknown } };
    };
    const url = payload.vc?.credentialStatus?.statusListCredential;
    return typeof url === "string" && url ? url : null;
  } catch {
    return null;
  }
};

/**
 * Can the holder of this credential reach the list it names?
 *
 * `publicOrigin` is the origin this deployment publishes its status list on.
 * Absent, we answer `origin_unknown` and say we cannot tell - failing closed,
 * because "cannot tell" rendering as "checks out" is the whole failure this
 * distinction exists to prevent.
 */
export const verifiabilityOf = (credit: CreditRecord, publicOrigin: string | undefined): Verifiability => {
  if (!credit.credentialJwt) return { verifiable: false, reason: "no_credential", listHost: null };

  const url = statusListUrlOf(credit.credentialJwt);
  if (!url) return { verifiable: false, reason: "no_status_entry", listHost: null };

  const origin = (value: string): string | null => {
    try {
      return new URL(value).origin;
    } catch {
      return null;
    }
  };

  const named = origin(url);
  if (!named) return { verifiable: false, reason: "no_status_entry", listHost: null };

  const expected = publicOrigin ? origin(publicOrigin) : null;
  if (!expected) return { verifiable: false, reason: "origin_unknown", listHost: named };

  return named === expected
    ? { verifiable: true, listHost: named }
    : { verifiable: false, reason: "unreachable_list", listHost: named };
};

/** Configuration, read where it is used so tests can set it without a module reload. */
const publicOrigin = (): string | undefined => process.env["PUBLIC_BASE_URL"];

const lookup = (creditId: string) =>
  ({ agent: "registry", skill: "lookupCredit", input: { creditId } }) as const;

/* ---------- credit_status ---------- */

export const planCreditStatus: Planner = (slots): Plan => {
  const creditId = slots.creditId?.trim();
  if (!creditId) return { status: "need", reply: msg("assistant.credit.need_id") };
  if (!CREDIT_ID.test(creditId)) {
    return { status: "need", reply: msg("assistant.credit.malformed_id", { creditId }) };
  }

  return {
    status: "read",
    calls: [lookup(creditId)],
    reply: (outputs) => {
      const credit = creditOf(outputs);
      if (!credit) return msg("assistant.credit.not_found", { creditId });

      const check = verifiabilityOf(credit, publicOrigin());
      const facts = {
        creditId: credit.creditId,
        status: credit.status,
        tonnes: credit.netTonnesCo2e,
        holder: credit.holder,
        issuedAt: credit.issuedAt,
      };

      /* Both claims, separately. A credential we cannot check is still
         reported for what it is - "not verifiable" is not "not valid", and
         collapsing them would either alarm someone whose credit is fine or
         reassure someone whose is not. */
      return check.verifiable
        ? msg("assistant.credit.status", facts)
        : msg("assistant.credit.status_not_verifiable", {
            ...facts,
            reason: check.reason,
            listHost: check.listHost ?? "",
          });
    },
  };
};

/* ---------- retire_credit ---------- */

export const planRetire: Planner = (slots): Plan => {
  const creditId = slots.creditId?.trim();
  if (!creditId) return { status: "need", reply: msg("assistant.credit.retire_need_id") };
  if (!CREDIT_ID.test(creditId)) {
    return { status: "need", reply: msg("assistant.credit.malformed_id", { creditId }) };
  }

  const retiredBy = slots.holder?.trim();
  if (!retiredBy) return { status: "need", reply: msg("assistant.credit.retire_need_holder", { creditId }) };

  return {
    status: "write",
    /* Names which credit and as whom - the two specifics a planner can know
       without calling anything. It cannot name the tonnage: this module is
       pure and never sees the credit, and the summary is what the
       confirmation signature commits to. See the PR; that gap is a change to
       types.ts, which is not my file. */
    summary: msg("assistant.credit.retire_summary", { creditId, retiredBy }),
    call: {
      agent: "registry",
      skill: "retireCredit",
      input: { creditId, retiredBy, reason: "retired via Saathi" },
    },
    /* Here the credit IS in hand, so the confirmation reports what actually
       happened in full rather than echoing the request back. */
    done: (output) => {
      const credit = creditOf([output]);
      if (!credit) return msg("assistant.credit.retired", { creditId, retiredBy });
      return msg("assistant.credit.retired_detail", {
        creditId: credit.creditId,
        tonnes: credit.netTonnesCo2e,
        holder: credit.holder,
        status: credit.status,
      });
    },
  };
};
