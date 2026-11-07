import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { buildAgentCard } from "./card.ts";
import { mintAgentToken } from "./auth.ts";
import { startAgentServer } from "./server.ts";

/* ------------------------------------------------------------------ *
 * The 401 on /a2a is enforced by the ORDER of two app.use calls, and until
 * this file nothing tested the order.
 *
 * auth.test.ts pins verifyAgentToken thoroughly - nine cases, including an
 * edited payload and a wrong secret. But every one of those calls the function
 * directly. Swap the guard and the handler in server.ts and all of them still
 * pass, while an unauthenticated POST /a2a runs the skill and returns a
 * completed task.
 *
 * That is not hypothetical. The comment above the middleware records that it
 * already happened once: "we were minting and verifying a JWT and then doing
 * nothing with the result... The token was decoration."
 *
 * What makes it hard to catch is that the handler is WILLING to serve an
 * anonymous caller - userBuilder returns {isAuthenticated: false} rather than
 * throwing - so nothing downstream refuses. The mount order is the only thing
 * standing there.
 *
 * Found by Hem (#92), while checking what backs Break It attack 3's claim.
 * ------------------------------------------------------------------ */

const ranTheSkill = vi.fn();

let server: Server;
let base: string;

beforeAll(async () => {
  /* Port 0 so this never collides with a running dev stack, and never with a
     second test file. */
  server = await startAgentServer({
    card: buildAgentCard({
      name: "authtest",
      version: "0.0.0",
      description: "boots for one test file and closes",
      url: "http://127.0.0.1:0/a2a",
      skills: [{ id: "echo", name: "Echo", description: "returns what it was given", tags: ["test"] }],
    }),
    port: 0,
    skills: {
      echo: {
        input: z.object({ say: z.string() }),
        run: async (input: { say: string }) => {
          ranTheSkill(input.say);
          return { said: input.say };
        },
      },
    },
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

/* Same wire shape callAgent uses, including the a2a-version header - without
   it the server assumes 0.3 and rejects every call. Built here rather than
   imported so a change to the client cannot silently weaken this test. */
const rpc = (headers: Record<string, string> = {}) =>
  fetch(`${base}/a2a`, {
    method: "POST",
    headers: { "content-type": "application/json", "a2a-version": "1.0", ...headers },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "SendMessage",
      params: {
        message: {
          messageId: "m_authtest",
          role: "ROLE_USER",
          parts: [{ data: { skill: "echo", input: { say: "hello" } } }],
          contextId: "",
          taskId: "",
          extensions: [],
          referenceTaskIds: [],
        },
      },
    }),
  });

describe("an unauthenticated /a2a call is refused before the handler sees it", () => {
  it("answers 401 with the unauthenticated code", async () => {
    const res = await rpc();
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error?: { code?: number } };
    expect(body.error?.code).toBe(-32001);
  });

  /* THE assertion. A 401 on its own would still pass if the handler ran first
     and the middleware merely overwrote the response afterwards - which is
     exactly the regression that happened before. The only proof that the
     guard is in front is that the skill did not execute. */
  it("does not run the skill", async () => {
    ranTheSkill.mockClear();
    await rpc();
    expect(ranTheSkill).not.toHaveBeenCalled();
  });

  it("refuses a bearer token that was edited after signing", async () => {
    const [h, p, sig] = mintAgentToken("gateway").split(".");
    const tampered = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(p!, "base64url").toString()), sub: "registry" }))
      .toString("base64url");
    ranTheSkill.mockClear();
    const res = await rpc({ authorization: `Bearer ${h}.${tampered}.${sig}` });
    expect(res.status).toBe(401);
    expect(ranTheSkill).not.toHaveBeenCalled();
  });

  /* Without this the file would pass by refusing everything, which is a guard
     that works and an agent that does not. */
  it("lets a properly signed call through to the skill", async () => {
    ranTheSkill.mockClear();
    const res = await rpc({ authorization: `Bearer ${mintAgentToken("gateway")}` });
    expect(res.status).toBe(200);
    expect(ranTheSkill).toHaveBeenCalledWith("hello");
  });

  /* The card mount is deliberately public - that is how discovery works - so
     a test forbidding it would be pinning the wrong thing. */
  it("still serves the Agent Card to an anonymous caller", async () => {
    const res = await fetch(`${base}/.well-known/agent-card.json`);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { name?: string }).name).toBe("authtest");
  });

  it("still answers health without a token", async () => {
    expect((await fetch(`${base}/health`)).status).toBe(200);
  });
});
