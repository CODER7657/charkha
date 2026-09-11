import { ed25519 } from "@noble/curves/ed25519";
import { bytesToHex } from "@noble/curves/utils";

/**
 * Generate the registry signing seed. Run once, put the hex in .env as
 * REGISTRY_DID_SEED, and never let it near a client bundle or a commit.
 *
 *   pnpm -F @charkha/agent-registry keygen
 */
const seed = ed25519.utils.randomSecretKey();
console.log("REGISTRY_DID_SEED=" + bytesToHex(seed));
console.log("\nPut this in .env (server side only). Regenerate before the demo if it has ever been pasted anywhere.");
