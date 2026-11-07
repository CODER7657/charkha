/**
 * The refusal an agent actually sent, if it sent one.
 *
 * Every agent refuses with a body that names the agent, the skill and the
 * reason:
 *
 *   { "error": "refused", "agent": "verifier", "skill": "verifyEvidence",
 *     "message": "...: hcOrgRatio 89 is out of bounds" }
 *
 * and the client threw all of it away, showing `/evidence -> HTTP 400`. A
 * field worker was told a number was wrong without being told WHICH number,
 * on a screen with seven of them. Reported from the deployed host.
 *
 * The `agent.skill: ` prefix is stripped because the reader is a farmer, not
 * an operator - the sentence after it is the part that helps.
 */
export const refusalFrom = (body: string): string | null => {
  try {
    const parsed = JSON.parse(body) as { message?: unknown; error?: unknown };
    const msg = typeof parsed.message === "string" ? parsed.message.trim() : "";
    if (msg) return msg.replace(/^[a-z]+\.[A-Za-z]+:\s*/, "");
    return typeof parsed.error === "string" ? parsed.error : null;
  } catch {
    /* Not JSON - a proxy error page, or an empty body. */
    return null;
  }
};

/** The only way the browser talks to the backend. Same origin, no keys here. */
const req = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  if (!res.ok) {
    /* Read the body before giving up on it. The status code alone names the
       symptom; the body names the cause, and we were discarding it. */
    const reason = refusalFrom(await res.text().catch(() => ""));
    throw new Error(reason ?? `${path} -> HTTP ${res.status}`);
  }
  return (await res.json()) as T;
};

export const api = {
  health: () => req<{ ok: boolean; agents: Array<{ name: string; up: boolean }> }>("/health"),
  lots: (q: string = "") => req<{ output: { lots: unknown[] } }>(`/lots${q}`),
  ingest: () => req<unknown>("/ingest", { method: "POST" }),
  match: (body: unknown) => req<unknown>("/match", { method: "POST", body: JSON.stringify(body) }),
  submitEvidence: (body: unknown) => req<unknown>("/evidence", { method: "POST", body: JSON.stringify(body) }),
  issue: (body: unknown) => req<unknown>("/credits/issue", { method: "POST", body: JSON.stringify(body) }),
  retire: (body: unknown) => req<unknown>("/credits/retire", { method: "POST", body: JSON.stringify(body) }),
  ledger: () => req<{ chain: unknown[]; verdict: { valid: boolean } }>("/ledger"),
  provenance: () => req<unknown>("/provenance"),
  trace: (taskId: string) => req<unknown>(`/trace/${encodeURIComponent(taskId)}`),
};
