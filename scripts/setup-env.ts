import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Generate .env from .env.example with fresh random secrets.
 *
 *   pnpm setup:env
 *
 * There are no default passwords anywhere in the repo on purpose - a default
 * is a value that quietly reaches the VPS. This fills the blanks instead, so
 * nobody is blocked on inventing one.
 *
 * Refuses to overwrite an existing .env. If you need new secrets, delete it
 * first and know what you are re-generating.
 */

const root = resolve(import.meta.dirname, "..");
const target = resolve(root, ".env");
const template = resolve(root, ".env.example");

if (existsSync(target)) {
  console.log(".env already exists - leaving it alone.");
  console.log("Delete it first if you really want fresh secrets.");
  process.exit(0);
}

const hex = (bytes: number) => randomBytes(bytes).toString("hex");

const pgPassword = hex(16);
const jwtSecret = hex(32);
const didSeed = hex(32);

const out = readFileSync(template, "utf8")
  .replace(/^POSTGRES_PASSWORD=.*$/m, `POSTGRES_PASSWORD=${pgPassword}`)
  .replace(/^DATABASE_URL=.*$/m, `DATABASE_URL=postgres://charkha:${pgPassword}@localhost:5432/charkha`)
  .replace(/^A2A_JWT_SECRET=.*$/m, `A2A_JWT_SECRET=${jwtSecret}`)
  .replace(/^REGISTRY_DID_SEED=.*$/m, `REGISTRY_DID_SEED=${didSeed}`);

writeFileSync(target, out, { mode: 0o600 });

console.log("Wrote .env with fresh secrets for Postgres, agent JWTs and the registry key.");
console.log("");
console.log("Still to fill in by hand:");
console.log("  FIRMS_MAP_KEY  - free, needs a registration round-trip:");
console.log("                   https://firms.modaps.eosdis.nasa.gov/api/map_key/");
console.log("");
console.log("Never commit .env. Regenerate REGISTRY_DID_SEED before the demo if it");
console.log("has ever been pasted into a chat, a log, or a screen share.");
