/**
 * End-to-end smoke test: can a caller actually reach a skill?
 *
 *   node scripts/smoke.mjs [baseUrl]
 *
 * Booting an agent and serving its Agent Card proves it is alive and
 * discoverable. It does not prove the transport works. The A2A transport sat
 * broken underneath a green build until someone tried to use it, so this
 * makes a real call through the gateway and checks something came back.
 *
 * Lives in a file rather than inline in the workflow on purpose - shell
 * quoting inside YAML is how the last version of this broke.
 */

const base = process.argv[2] ?? "http://localhost:4000";

const fail = (msg) => {
  console.error(`FAIL  ${msg}`);
  process.exit(1);
};
const ok = (msg) => console.log(`ok    ${msg}`);

const getJson = async (path) => {
  let res;
  try {
    res = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(30_000) });
  } catch (err) {
    fail(`${path} - request failed: ${err.message}`);
  }
  const body = await res.text();
  if (!res.ok) fail(`${path} - HTTP ${res.status}: ${body.slice(0, 400)}`);
  try {
    return JSON.parse(body);
  } catch {
    return fail(`${path} - response was not JSON: ${body.slice(0, 400)}`);
  }
};

/* 1. Every agent in the mesh reports healthy. */
const health = await getJson("/api/health");
const down = (health.agents ?? []).filter((a) => !a.up).map((a) => a.name);
if (down.length) fail(`agents down: ${down.join(", ")}`);
ok(`mesh healthy (${(health.agents ?? []).length} agents)`);

/* 2. A real skill call reaches an agent and comes back with a result.
      This is the part that catches a broken transport. */
const lots = await getJson("/api/lots");

if (!lots || typeof lots !== "object") fail("/api/lots returned no object");
if (!lots.taskId) {
  fail(
    "/api/lots returned no taskId - the call never reached a skill.\n" +
      "      Check the A2A transport: handler mounting, the a2a-version header,\n" +
      "      and the wire shape of params.message / parts.",
  );
}
if (lots.output === undefined) fail(`/api/lots task ${lots.taskId} returned no output`);
ok(`producer.listLots reachable - task ${lots.taskId} completed`);

console.log("\nsmoke passed: the mesh is alive and a skill is reachable end to end.");
