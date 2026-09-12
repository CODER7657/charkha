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

/* 3. The published status list is actually a credential, and actually public.
      Every credential names this URL inside its own signature, so it cannot be
      corrected after issuing. It had no route on the gateway and fell through
      to the SPA fallback: HTTP 200, content-type text/html, an index.html page
      where a signed credential should be. A holder following that URL got a
      success code and a web page.

      Checking the status code alone is what let it through, so this checks the
      thing itself - three segments, and a payload carrying a bitstring. */
const statusRes = await fetch(`${base}/status/credits`, { signal: AbortSignal.timeout(30_000) });
if (!statusRes.ok) fail(`/status/credits - HTTP ${statusRes.status}`);

const jwt = (await statusRes.text()).trim();
const parts = jwt.split(".");
if (parts.length !== 3) {
  fail(
    `/status/credits did not return a compact JWT (got ${parts.length} segment(s), ` +
      `content-type ${statusRes.headers.get("content-type")}).\n` +
      `      First bytes: ${jwt.slice(0, 120)}\n` +
      "      If that looks like HTML, the gateway has no route for this path and the\n" +
      "      SPA fallback answered instead - see apps/gateway/src/index.ts.",
  );
}

let subject;
try {
  const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  subject = (payload.vc ?? payload).credentialSubject ?? {};
} catch (err) {
  fail(`/status/credits payload did not decode as JSON: ${err.message}`);
}
if (!subject.encodedList) fail("/status/credits carries no encodedList - it is not a status list");
ok(`status list published and signed (purpose ${subject.statusPurpose ?? "?"})`);

/* 4. The URL baked into new credentials resolves to where we just read it from.
      If these differ, credentials issued right now name an address no holder
      can reach - inside the signature, so no later deploy repairs them. */
const listId = String(subject.id ?? "").replace(/#.*$/, "");
const expected = new URL("/status/credits", base).toString();
if (listId && listId !== expected) {
  fail(
    `the status list calls itself ${listId}\n` +
      `      but we fetched it from ${expected}.\n` +
      "      PUBLIC_BASE_URL is wrong for this deployment. Every credential issued in\n" +
      "      this state names an unreachable list, inside its signature - reissue them.",
  );
}
ok(`status list URL matches this origin (${expected})`);

console.log(
  "\nsmoke passed: the mesh is alive, a skill is reachable, and revocation is publicly checkable.",
);
