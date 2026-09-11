import { mintAgentToken } from "./auth.ts";

/* ------------------------------------------------------------------ *
 * Calling another agent. One function.
 *
 *   const out = await callAgent(MATCHMAKER, "runMatching", { maxRadiusKm: 60 });
 *
 * Uses plain JSON-RPC against the agent's /a2a endpoint so there is no
 * transport-factory ceremony in your agent code. The task lifecycle is
 * still real - we read the terminal task state off the response.
 * ------------------------------------------------------------------ */

export type AgentTarget = { name: string; baseUrl: string };

export const AGENTS = {
  producer: () => ({ name: "producer", baseUrl: process.env["PRODUCER_URL"] ?? "http://localhost:4001" }),
  matchmaker: () => ({ name: "matchmaker", baseUrl: process.env["MATCHMAKER_URL"] ?? "http://localhost:4002" }),
  verifier: () => ({ name: "verifier", baseUrl: process.env["VERIFIER_URL"] ?? "http://localhost:4003" }),
  registry: () => ({ name: "registry", baseUrl: process.env["REGISTRY_URL"] ?? "http://localhost:4004" }),
} as const;

type RpcResult = {
  result?: { task?: { id?: string; status?: { state?: unknown; message?: { parts?: unknown[] } } } };
  error?: { message?: string };
};

const extract = (payload: RpcResult): { taskId: string; output: unknown; failed: boolean; text: string } => {
  const task = payload.result?.task;
  // On the wire a v1.0 part is {data} or {text}; the protobuf {content:{$case}}
  // shape is what the SDK hands the executor internally. Read both.
  const parts = (task?.status?.message?.parts ?? []) as Array<{
    data?: unknown;
    text?: unknown;
    content?: { $case: string; value: unknown };
  }>;
  let output: unknown;
  let text = "";
  for (const p of parts) {
    if (p.data !== undefined) output = p.data;
    else if (p.content?.$case === "data") output = p.content.value;
    if (p.text !== undefined) text += String(p.text);
    else if (p.content?.$case === "text") text += String(p.content.value);
  }
  const state = String(task?.status?.state ?? "");
  return { taskId: task?.id ?? "", output, failed: /FAILED|4/.test(state) && output === undefined, text };
};

export const callAgent = async <T>(
  target: AgentTarget,
  skill: string,
  input: unknown,
  opts: { callerName?: string; timeoutMs?: number } = {},
): Promise<{ taskId: string; output: T }> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 30_000);
  try {
    const res = await fetch(`${target.baseUrl}/a2a`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        // Without this the server assumes 0.3 and rejects every call.
        "a2a-version": "1.0",
        authorization: `Bearer ${mintAgentToken(opts.callerName ?? "charkha-agent")}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: Date.now(),
        method: "SendMessage",
        params: {
          message: {
            messageId: `m_${Date.now()}`,
            role: "ROLE_USER",
            parts: [{ data: { skill, input } }],
            contextId: "",
            taskId: "",
            extensions: [],
            referenceTaskIds: [],
          },
        },
      }),
    });
    if (!res.ok) throw new Error(`${target.name} returned HTTP ${res.status}`);
    const payload = (await res.json()) as RpcResult;
    if (payload.error) throw new Error(`${target.name}: ${payload.error.message ?? "rpc error"}`);
    const { taskId, output, failed, text } = extract(payload);
    if (failed) throw new Error(`${target.name}.${skill} failed: ${text || "no detail"}`);
    return { taskId, output: output as T };
  } finally {
    clearTimeout(timer);
  }
};
