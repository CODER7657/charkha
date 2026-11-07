import type { AssistantAnswerOutput, AssistantLang } from "@charkha/core";

/* ------------------------------------------------------------------ *
 * OWNER: core
 *
 * The one call this view makes.
 *
 * Kept apart from `api.ts` deliberately: the gateway route it needs does not
 * exist yet, and Saathi stays fully separable from the four screens that are
 * already deployed and verified until the whole thing is proven. Integration
 * is one PR that adds the route, the nav entry and the compose service
 * together, at which point this can move or stay - it is three lines either
 * way.
 * ------------------------------------------------------------------ */

export type Ask = (
  utterance: string,
  lang: AssistantLang,
  confirm?: string,
  identity?: string,
) => Promise<AssistantAnswerOutput>;

export const ask: Ask = async (utterance, lang, confirm, identity) => {
  const res = await fetch("/api/saathi", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ utterance, lang, confirm, identity }),
  });

  const body: unknown = await res.json().catch(() => null);

  if (!res.ok) {
    /* The gateway turns an agent's refusal into a 400 carrying its message.
       Surfacing that verbatim beats "request failed": a refusal is usually
       something the person can act on, and hiding it behind a status code is
       how a working guard gets reported as an outage. */
    const detail =
      body && typeof body === "object" && "message" in body
        ? String((body as { message: unknown }).message)
        : `HTTP ${res.status}`;
    throw new Error(detail);
  }

  return (body as { output: AssistantAnswerOutput }).output;
};
