import { fileURLToPath } from "node:url";
import path from "node:path";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { loadEnv, AGENTS, callAgent, AgentRequestError } from "@charkha/a2a";
import { readChain, verifyLedger } from "@charkha/db/ledger";
import { verifyChain, type TraceBundle } from "@charkha/core";
import { buildTrace } from "./trace.ts";

loadEnv();

/* ------------------------------------------------------------------ *
 * OWNER: core (Pavan)
 *
 * One origin. The browser talks only to this; it never talks to an agent
 * directly and never holds a signing key. Agent-to-agent JWTs are minted
 * here, server side.
 * ------------------------------------------------------------------ */

const PORT = Number(process.env["GATEWAY_PORT"] ?? 4000);
const app = Fastify({ logger: { level: "info" } });

const here = path.dirname(fileURLToPath(import.meta.url));
const webDist = path.resolve(here, "../../web/dist");

/* Every /api response is live state - the ledger, lots, matches, credits.
   None of it carries validators, so with no Cache-Control a browser applies
   heuristic caching and can serve a GET from its own cache. That is how the
   Audit console showed a previous run's chain after switching views: the
   component remounted and refetched correctly, and the browser answered from
   cache. Static assets under / are untouched and still cache normally. */
app.addHook("onSend", async (req, reply) => {
  if (req.url.startsWith("/api/")) reply.header("cache-control", "no-store");
});

/* A request an agent refused because of its own contents is the caller's
   problem, not an outage. 500 for a bad payload sends whoever is debugging to
   the server logs for something that is in their request. */
app.setErrorHandler((err, _req, reply) => {
  if (err instanceof AgentRequestError) {
    app.log.info({ agent: err.agent, skill: err.skill }, "refused");
    return reply.code(400).send({ error: "refused", agent: err.agent, skill: err.skill, message: err.message });
  }
  app.log.error({ err }, "unhandled");
  const status = typeof (err as { statusCode?: unknown }).statusCode === "number"
    ? (err as { statusCode: number }).statusCode
    : 500;
  const message = err instanceof Error ? err.message : "unexpected error";
  return reply.code(status).send({ error: "internal", message });
});

app.get("/api/health", async () => {
  const check = async (name: keyof typeof AGENTS) => {
    try {
      const res = await fetch(`${AGENTS[name]().baseUrl}/health`, { signal: AbortSignal.timeout(2000) });
      return { name, up: res.ok };
    } catch {
      return { name, up: false };
    }
  };
  const agents = await Promise.all((Object.keys(AGENTS) as Array<keyof typeof AGENTS>).map(check));
  return { ok: agents.every((a) => a.up), agents };
});

/* ---- producer / operator ---- */
app.post("/api/ingest", async () => callAgent(AGENTS.producer(), "ingestBurns", {}, { callerName: "gateway" }));
app.get("/api/lots", async (req) => {
  const q = req.query as { district?: string; status?: string };
  return callAgent(AGENTS.producer(), "listLots", { ...q, limit: 200 }, { callerName: "gateway" });
});

/* ---- matchmaker ---- */
app.post("/api/match", async (req) => {
  const body = (req.body ?? {}) as { district?: string; maxRadiusKm?: number };
  return callAgent(AGENTS.matchmaker(), "runMatching", { maxRadiusKm: 60, ...body }, { callerName: "gateway" });
});
app.get("/api/units", async (req) => {
  const q = req.query as { feedstock?: string };
  return callAgent(AGENTS.matchmaker(), "listUnits", { ...q, limit: 200 }, { callerName: "gateway" });
});

/* ---- verifier ---- */
app.post("/api/evidence", async (req) =>
  callAgent(AGENTS.verifier(), "verifyEvidence", req.body, { callerName: "gateway" }),
);

/* ---- registry ---- */
app.post("/api/credits/issue", async (req) =>
  callAgent(AGENTS.registry(), "issueCredit", req.body, { callerName: "gateway" }),
);
app.post("/api/credits/retire", async (req) =>
  callAgent(AGENTS.registry(), "retireCredit", req.body, { callerName: "gateway" }),
);

/* ---- the thing a judge follows ---- */
app.get("/api/ledger", async () => {
  const chain = await readChain();
  return { chain, verdict: verifyChain(chain) };
});

app.get("/api/trace/:taskId", async (req, reply) => {
  const { taskId } = req.params as { taskId: string };
  const bundle: TraceBundle | null = await buildTrace(taskId);
  if (!bundle) return reply.code(404).send({ error: "no such task id" });
  return bundle;
});

app.get("/api/verify-ledger", async () => verifyLedger());

/* ---- serve the built SPA from the same origin ---- */
try {
  await app.register(fastifyStatic, { root: webDist, prefix: "/" });
  app.setNotFoundHandler(async (req, reply) => {
    if (req.url.startsWith("/api/")) return reply.code(404).send({ error: "not found" });
    return reply.sendFile("index.html");
  });
} catch {
  app.log.warn("web/dist not built yet - run: pnpm build:web");
}

/* Dual-stack on purpose.
 *
 * Binding 0.0.0.0 is IPv4-only, and Node resolves "localhost" to ::1 first on
 * most systems - so any server-side fetch("http://localhost:4000/...") failed
 * with ECONNREFUSED ::1:4000 while the browser and Docker were perfectly fine.
 * Every caller having to remember 127.0.0.1 is the wrong fix; the gateway
 * accepting both is the right one.
 *
 * :: with ipv6Only off also accepts IPv4-mapped connections, so this is a
 * superset of the old behaviour. Falls back where IPv6 is unavailable in the
 * container, rather than refusing to start. */
try {
  await app.listen({ port: PORT, host: "::", ipv6Only: false });
} catch (err) {
  app.log.warn({ err }, "could not bind IPv6, falling back to IPv4 only");
  await app.listen({ port: PORT, host: "0.0.0.0" });
}
