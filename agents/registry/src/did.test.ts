import { describe, it, expect } from "vitest";
import { ed25519 } from "@noble/curves/ed25519.js";
import { bytesToHex } from "@noble/curves/utils.js";
import { createVerifiableCredentialJwt, verifyCredential } from "did-jwt-vc";
import { base58btc, didKeyFromPublicKey, didResolver, issuerFromSeed } from "./did.ts";

/* A fixed seed so these tests are deterministic. Test-only - the real one
   lives in .env and is never committed. */
const SEED = "9".repeat(64);

describe("base58btc", () => {
  it("matches the reference encoding", () => {
    expect(base58btc(new TextEncoder().encode("hello world"))).toBe("StV1DL6CwTryKyV");
  });
  it("encodes each leading zero byte as a leading 1", () => {
    expect(base58btc(Uint8Array.from([0, 0, 1]))).toBe("112");
  });
});

describe("did:key", () => {
  it("produces an Ed25519 did:key", () => {
    const did = didKeyFromPublicKey(ed25519.getPublicKey(Uint8Array.from(Buffer.from(SEED, "hex"))));
    // Every Ed25519 did:key carries the 0xed01 multicodec, which always
    // renders as this prefix. If this breaks, the DID will not resolve.
    expect(did.startsWith("did:key:z6Mk")).toBe(true);
  });

  it("resolves to the public key it was built from", async () => {
    const issuer = issuerFromSeed(SEED);
    const resolved = await didResolver.resolve(issuer.did);
    expect(resolved.didResolutionMetadata.error).toBeUndefined();
    expect(resolved.didDocument?.id).toBe(issuer.did);
  });
});

describe("credential signing", () => {
  const payload = {
    sub: "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK",
    nbf: 1_600_000_000,
    vc: {
      "@context": ["https://www.w3.org/2018/credentials/v1"],
      type: ["VerifiableCredential"],
      credentialSubject: { netTonnesCo2e: 1.23 },
    },
  };

  it("signs a credential that verifies against the resolved DID", async () => {
    const issuer = issuerFromSeed(SEED);
    const jwt = await createVerifiableCredentialJwt(payload, issuer);
    const verified = await verifyCredential(jwt, didResolver);
    expect(verified.verified).toBe(true);
    expect(verified.issuer).toBe(issuer.did);
  });

  it("rejects a credential whose payload was edited after signing", async () => {
    const issuer = issuerFromSeed(SEED);
    const jwt = await createVerifiableCredentialJwt(payload, issuer);
    const [header, body, signature] = jwt.split(".");
    const decoded = JSON.parse(Buffer.from(body!, "base64url").toString()) as typeof payload;
    decoded.vc.credentialSubject.netTonnesCo2e = 999;
    const forged = [header, Buffer.from(JSON.stringify(decoded)).toString("base64url"), signature].join(".");

    await expect(verifyCredential(forged, didResolver)).rejects.toThrow();
  });

  it("a different seed is a different issuer", () => {
    const other = bytesToHex(ed25519.utils.randomSecretKey());
    expect(issuerFromSeed(other).did).not.toBe(issuerFromSeed(SEED).did);
  });
});
