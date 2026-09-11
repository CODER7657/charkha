/** The only way the browser talks to the backend. Same origin, no keys here. */
const req = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}`);
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
  trace: (taskId: string) => req<unknown>(`/trace/${encodeURIComponent(taskId)}`),
};
