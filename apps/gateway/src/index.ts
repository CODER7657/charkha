import { fileURLToPath } from "node:url";
import path from "node:path";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { loadEnv, AGENTS, callAgent, AgentRequestError } from "@charkha/a2a";
import { readChain, verifyLedger } from "@charkha/db/ledger";
import { verifyChain, FACTORS, type TraceBundle } from "@charkha/core";
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

/* ---- provenance: every "where did that come from" answered on screen ----
 *
 * The IPCC citations, the model's honest status, the feed we actually pull and
 * what is real versus simulated all lived in commit messages and markdown. A
 * judge looking at the UI could only take our word for it. This puts the
 * receipts where the claim is made.
 *
 * Everything here is read live from the running system - the factors from the
 * module the maths uses, the model hash from the verifier's loaded file, the
 * feed from the producer's own config. Nothing is retyped, so nothing can
 * drift from what the system actually does. */
app.get("/api/provenance", async () => {
  const ask = async (name: keyof typeof AGENTS, path: string) => {
    try {
      const res = await fetch(`${AGENTS[name]().baseUrl}${path}`, { signal: AbortSignal.timeout(4000) });
      return res.ok ? await res.json() : null;
    } catch {
      return null;
    }
  };

  const [rawModel, did] = await Promise.all([ask("verifier", "/model"), ask("registry", "/did")]);

  /* The verifier reports {version, sha256, loaded}. Normalise it here rather
     than letting the view guess at field names - it was reading `hash` and
     `trained`, neither of which exists, so the sha256 that goes in the ledger
     never rendered and "not trained" was right only by accident.
     `trained` is derived from the version, which is the convention
     ml/models/MANIFEST.md already uses, and it fails closed: anything we
     cannot positively identify as trained is reported as not trained. */
  const version = (rawModel as { version?: string } | null)?.version ?? null;
  const model = rawModel
    ? {
        version,
        hash: (rawModel as { sha256?: string }).sha256 ?? null,
        loaded: (rawModel as { loaded?: boolean }).loaded ?? false,
        trained: Boolean(version) && !/baseline|untrained|stub|no-model/i.test(version!),
      }
    : null;

  return {
    carbon: {
      factors: Object.entries(FACTORS).map(([key, f]) => ({
        key,
        value: f.value,
        unit: f.unit,
        source: f.source,
      })),
      formula:
        "net tCO2e = biochar_t x sequestration_factor x quality - transport_debit - process_debit",
    },
    model,
    issuer: did,
    feed: {
      source: process.env["FIRMS_SOURCE"] ?? "VIIRS_NOAA20_NRT",
      bbox: process.env["FIRMS_BBOX"] ?? null,
      dayRange: Number(process.env["FIRMS_DAY_RANGE"] ?? 2),
      note: "NASA FIRMS, read-only. The only outbound request this system makes.",
    },
  };
});

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
