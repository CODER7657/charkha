import { randomBytes } from "node:crypto";

/**
 * Generate the registry signing seed. Run once, put the hex in .env as
 * REGISTRY_DID_SEED, and never let it near a client bundle or a commit.
 *
 *   pnpm -F @charkha/agent-registry keygen
 *
 * A did:key Ed25519 seed is just 32 random bytes, so this uses node's own CSPRNG
 * rather than pulling a curve library in for one line.
 */
const seed = randomBytes(32).toString("hex");

console.log("REGISTRY_DID_SEED=" + seed);
console.log(
  "\nPut this in .env (server side only). Regenerate before the demo if it has ever been pasted anywhere.",
);
