import { ed25519 } from "@noble/curves/ed25519.js";
import { Resolver, type ResolverRegistry } from "did-resolver";
import { getResolver } from "key-did-resolver";
import type { Issuer } from "did-jwt-vc";

/**
 * OWNER: Ayush
 *
 * Locally-generated did:key + the Issuer that did-jwt-vc expects.
 * No DID registry, no chain, no hosted service - the key lives in .env and
 * never leaves the server.
 *
 * The public half of the key IS the DID, so anyone holding a credential can
 * resolve the issuer and check the signature without asking us for anything.
 * That is the whole argument for did:key here.
 */

/** multicodec prefix for an Ed25519 public key, as did:key requires. */
const ED25519_MULTICODEC = Uint8Array.from([0xed, 0x01]);

const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/** base58btc, the encoding did:key uses. Short enough to own rather than depend on. */
export const base58btc = (bytes: Uint8Array): string => {
  // Every leading zero byte encodes as one leading "1"; the rest is base conversion.
  let leadingZeros = 0;
  while (leadingZeros < bytes.length && bytes[leadingZeros] === 0) leadingZeros++;

  const digits: number[] = [];
  for (const byte of bytes.subarray(leadingZeros)) {
    let carry = byte;
    for (let i = 0; i < digits.length; i++) {
      carry += digits[i]! << 8;
      digits[i] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }

  return "1".repeat(leadingZeros) + digits.reverse().map((d) => BASE58_ALPHABET[d]!).join("");
};

const hexToBytes = (hex: string): Uint8Array => {
  const clean = hex.trim().toLowerCase().replace(/^0x/, "");
  if (!/^[0-9a-f]+$/.test(clean) || clean.length % 2 !== 0)
    throw new Error("REGISTRY_DID_SEED is not hex - regenerate with: pnpm -F @charkha/agent-registry keygen");
  return Uint8Array.from(clean.match(/../g)!.map((b) => parseInt(b, 16)));
};

/** did:key for an Ed25519 public key: "did:key:z" + base58btc(0xed01 || pubkey). */
export const didKeyFromPublicKey = (publicKey: Uint8Array): string =>
  `did:key:z${base58btc(Uint8Array.from([...ED25519_MULTICODEC, ...publicKey]))}`;

/**
 * Build the signing Issuer from a hex seed. Server side only - if this ever
 * runs in a browser bundle we have leaked the registry's private key.
 */
export const issuerFromSeed = (seedHex: string): Issuer => {
  const secretKey = hexToBytes(seedHex);
  const did = didKeyFromPublicKey(ed25519.getPublicKey(secretKey));
  return {
    did,
    alg: "EdDSA",
    signer: async (data) => {
      const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
      return Buffer.from(ed25519.sign(bytes, secretKey)).toString("base64url");
    },
  };
};

let cached: Issuer | undefined;

/**
 * The registry's issuer. Lazy on purpose: the agent must still boot (and serve
 * its Agent Card) on a machine that has no seed, it just cannot issue.
 */
export const getIssuer = (): Issuer => {
  if (cached) return cached;
  const seed = process.env["REGISTRY_DID_SEED"];
  if (!seed) throw new Error("REGISTRY_DID_SEED missing - run: pnpm -F @charkha/agent-registry keygen");
  cached = issuerFromSeed(seed);
  return cached;
};

/** Resolver for did:key. This is the verification side - no network, no registry. */
// key-did-resolver does not declare did-resolver as a dependency, so its types
// can resolve against a different copy than did-jwt-vc's. Same shape at
// runtime; the cast is purely to reconcile the two declarations.
export const didResolver = new Resolver(getResolver() as ResolverRegistry);
