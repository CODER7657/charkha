/**
 * OWNER: Ayush
 *
 * Locally-generated did:key + the Issuer that did-jwt-vc expects.
 * No DID registry, no chain, no hosted service - the key lives in .env and
 * never leaves the server.
 *
 * Shape you need:
 *   const issuer: Issuer = { did, signer: ES256KSigner|EdDSASigner, alg: "EdDSA" }
 * then `createVerifiableCredentialJwt(payload, issuer)`.
 *
 * Verification side: `verifyCredential(jwt, resolver)` with a Resolver built
 * from key-did-resolver's getResolver(). Wire that up too - the audit console
 * verifies credentials rather than trusting our own database, and a judge
 * will absolutely ask whether you actually check the signature.
 */
export const getIssuer = () => {
  const seed = process.env["REGISTRY_DID_SEED"];
  if (!seed) throw new Error("REGISTRY_DID_SEED missing - run: pnpm -F @charkha/agent-registry keygen");
  throw new Error("TODO(ayush): build did:key issuer from seed");
};
