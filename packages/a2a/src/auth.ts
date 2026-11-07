import { createHmac, timingSafeEqual } from "node:crypto";

/* Minimal HS256 JWT. Deliberately tiny - one dependency fewer to break at 3am.
   Treat every other agent as untrusted: mint on the way out, verify on the way in. */

const b64u = (b: Buffer) => b.toString("base64url");
const secret = () => process.env["A2A_JWT_SECRET"] ?? "dev_only_change_me";
const issuer = () => process.env["A2A_JWT_ISSUER"] ?? "charkha";

export type AgentClaims = { sub: string; iss: string; iat: number; exp: number };

export const mintAgentToken = (subject: string, ttlSec = 300): string => {
  const now = Math.floor(Date.now() / 1000);
  const header = b64u(Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const payload = b64u(Buffer.from(JSON.stringify({ sub: subject, iss: issuer(), iat: now, exp: now + ttlSec })));
  const sig = b64u(createHmac("sha256", secret()).update(`${header}.${payload}`).digest());
  return `${header}.${payload}.${sig}`;
};

export const verifyAgentToken = (authorization?: string): AgentClaims | null => {
  if (!authorization?.startsWith("Bearer ")) return null;
  const parts = authorization.slice(7).trim().split(".");
  if (parts.length !== 3) return null;
  const [h, p, s] = parts as [string, string, string];
  const expected = Buffer.from(createHmac("sha256", secret()).update(`${h}.${p}`).digest().toString("base64url"));
  const got = Buffer.from(s);
  if (expected.length !== got.length || !timingSafeEqual(expected, got)) return null;
  try {
    const claims = JSON.parse(Buffer.from(p, "base64url").toString()) as AgentClaims;
    if (claims.iss !== issuer()) return null;
    if (claims.exp < Math.floor(Date.now() / 1000)) return null;
    return claims;
  } catch {
    return null;
  }
};
