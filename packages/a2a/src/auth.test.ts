import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mintAgentToken, verifyAgentToken } from "./auth.ts";

/* ------------------------------------------------------------------ *
 * Agent-to-agent auth.
 *
 * "Treat every other agent as untrusted by default" is a rule we wrote down
 * and then did not enforce: the token was minted, verified, and the result
 * thrown away, so an unauthenticated POST /a2a ran the skill and returned a
 * completed task. Found by trying it against the deployed stack from another
 * container, not by reading the code.
 *
 * These pin the token itself. The route-level refusal is exercised by CI's
 * compose-stack job, which calls a skill through the gateway with a token and
 * would fail if the gate rejected a legitimate call.
 * ------------------------------------------------------------------ */

const SECRET = "test-secret-for-agent-auth";

describe("agent tokens", () => {
  beforeEach(() => {
    process.env["A2A_JWT_SECRET"] = SECRET;
    process.env["A2A_JWT_ISSUER"] = "charkha-test";
  });
  afterEach(() => {
    delete process.env["A2A_JWT_SECRET"];
    delete process.env["A2A_JWT_ISSUER"];
  });

  it("accepts a token it just minted", () => {
    const claims = verifyAgentToken(`Bearer ${mintAgentToken("gateway")}`);
    expect(claims?.sub).toBe("gateway");
  });

  it("refuses a missing header", () => {
    expect(verifyAgentToken(undefined)).toBeNull();
  });

  it("refuses a header that is not a bearer token", () => {
    expect(verifyAgentToken(`Basic ${mintAgentToken("gateway")}`)).toBeNull();
    expect(verifyAgentToken("Bearer")).toBeNull();
  });

  it("refuses a malformed token", () => {
    for (const bad of ["Bearer x", "Bearer a.b", "Bearer a.b.c.d", "Bearer ..", "Bearer "]) {
      expect(verifyAgentToken(bad), bad).toBeNull();
    }
  });

  /* The one that matters: a token whose payload was edited after signing. An
     attacker rewriting `sub` to impersonate another agent must not pass. */
  it("refuses a token whose payload was edited after signing", () => {
    const [h, p, s] = mintAgentToken("gateway").split(".") as [string, string, string];
    const claims = JSON.parse(Buffer.from(p, "base64url").toString());
    claims.sub = "registry";
    const forged = Buffer.from(JSON.stringify(claims)).toString("base64url");
    expect(verifyAgentToken(`Bearer ${h}.${forged}.${s}`)).toBeNull();
  });

  it("refuses a token signed with a different secret", () => {
    const token = mintAgentToken("gateway");
    process.env["A2A_JWT_SECRET"] = "a-different-secret";
    expect(verifyAgentToken(`Bearer ${token}`)).toBeNull();
  });

  it("refuses a token from another issuer", () => {
    const token = mintAgentToken("gateway");
    process.env["A2A_JWT_ISSUER"] = "somebody-else";
    expect(verifyAgentToken(`Bearer ${token}`)).toBeNull();
  });

  it("refuses an expired token", () => {
    expect(verifyAgentToken(`Bearer ${mintAgentToken("gateway", -1)}`)).toBeNull();
  });

  it("accepts a token that is still within its lifetime", () => {
    expect(verifyAgentToken(`Bearer ${mintAgentToken("gateway", 60)}`)?.sub).toBe("gateway");
  });
});
