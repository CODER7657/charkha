/**
 * A token-injecting proxy, so the A2A Inspector can talk to our agents.
 *
 *   node scripts/inspector-proxy.mjs
 *
 * The Inspector is the official tool for reading live A2A traffic and running
 * spec-compliance checks. It does not support bearer tokens, and our agents
 * refuse unauthenticated calls (#41).
 *
 * The wrong fix is to turn our own auth off for the demo. This is the right
 * one: the Inspector talks to this, and this talks to the agent with a freshly
 * minted token. The security property is unchanged - an agent still refuses
 * anything unauthenticated - and nothing long-lived is written to a config
 * file, because the token is minted per request and lives about five minutes.
 *
 * Route by agent name, so one Inspector can reach all four:
 *
 *   http://localhost:4010/producer     -> producer:4001
 *   http://localhost:4010/matchmaker   -> matchmaker:4002
 *   http://localhost:4010/verifier     -> verifier:4003
 *   http://localhost:4010/registry     -> registry:4004
 *
 * Point the Inspector at one of those as the agent server base URL; it fetches
 * the card from there and everything downstream is signed for it.
 *
 * Demo-only. It runs under the `demo` compose profile and is not part of the
 * deployed stack.
 */

import http from "node:http";
import { AGENTS, mintAgentToken } from "@charkha/a2a";
import { loadEnv } from "@charkha/a2a";

loadEnv();

const PORT = Number(process.env["INSPECTOR_PROXY_PORT"] ?? 4010);
const NAMES = Object.keys(AGENTS);

const targetFor = (pathname) => {
  const [, name, ...rest] = pathname.split("/");
  if (!name || !NAMES.includes(name)) return null;
  return { base: AGENTS[name]().baseUrl, path: `/${rest.join("/")}`, name };
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://proxy");
  const target = targetFor(url.pathname);

  if (!target) {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        error: "unknown agent",
        hint: `use one of ${NAMES.map((n) => `/${n}`).join(", ")} as the agent server base URL`,
      }),
    );
    return;
  }

  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const body = Buffer.concat(chunks);
    void (async () => {
      try {
        const upstream = await fetch(`${target.base}${target.path}${url.search}`, {
          method: req.method,
          headers: {
            ...Object.fromEntries(
              Object.entries(req.headers).filter(
                // Drop hop-by-hop headers and anything we are about to set.
                ([k]) => !["host", "connection", "authorization", "content-length"].includes(k),
              ),
            ),
            // The two things the Inspector cannot send for itself.
            authorization: `Bearer ${mintAgentToken("a2a-inspector")}`,
            "a2a-version": "1.0",
          },
          body: ["GET", "HEAD"].includes(req.method ?? "GET") ? undefined : body,
        });

        const text = await upstream.text();
        res.writeHead(upstream.status, {
          "content-type": upstream.headers.get("content-type") ?? "application/json",
          // The Inspector is served from a different origin.
          "access-control-allow-origin": "*",
        });
        res.end(text);
      } catch (err) {
        res.writeHead(502, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "upstream unreachable", agent: target.name, detail: String(err) }));
      }
    })();
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`inspector proxy on :${PORT}`);
  for (const n of NAMES) console.log(`  /${n}  ->  ${AGENTS[n]().baseUrl}`);
  console.log("\nPoint the A2A Inspector at one of those paths as the agent server base URL.");
});
