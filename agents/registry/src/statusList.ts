import { gzipSync } from "node:zlib";
import { createVerifiableCredentialJwt, type Issuer } from "did-jwt-vc";
import type { CreditRecord } from "@charkha/core";

/* ------------------------------------------------------------------ *
 * The status list.
 *
 * A credential points at this list and carries its own index in it. A
 * holder - or a buyer, or a judge - fetches the list and checks one bit to
 * see whether the credit is still live. They never have to ask our API for
 * permission, and they never have to trust our database.
 *
 * That is the honest answer to "why no blockchain": portable, offline
 * checkable proof of retirement without consensus.
 * ------------------------------------------------------------------ */

/** W3C Bitstring Status List requires a list of at least 16KB. */
const LIST_BYTES = 16 * 1024;

export const STATUS_LIST_ID = "credits";

/**
 * The absolute URL a holder will fetch to check revocation.
 *
 * PUBLIC_BASE_URL comes first, and that ordering is the whole fix. This read
 * `REGISTRY_PUBLIC_URL ?? REGISTRY_URL`, and REGISTRY_URL is `http://registry:4004`
 * under compose - an address that exists only inside the Docker network. The
 * variable documented in .env.example and actually set on the VM is
 * PUBLIC_BASE_URL, which nothing here consulted, so every credential issued on
 * the deployed host named a status list no holder could reach.
 *
 * This URL goes INSIDE the signature. It cannot be corrected afterwards, so a
 * credential minted while this is wrong is disposable - reissue rather than
 * repair. Check it after any deploy:
 *
 *   curl -s https://<host>/status/credits | cut -d. -f2 | base64 -d
 *
 * The list is served by the gateway, not by the registry's own port, because
 * the gateway is the only origin published to the internet.
 */
const statusListUrl = (): string => {
  const base =
    process.env["PUBLIC_BASE_URL"] ??
    process.env["REGISTRY_PUBLIC_URL"] ??
    process.env["REGISTRY_URL"] ??
    "http://localhost:4004";
  return `${base.replace(/\/+$/, "")}/status/${STATUS_LIST_ID}`;
};

/** The `credentialStatus` block that goes inside a credential. */
export const statusListEntry = (index: number) => ({
  id: `${statusListUrl()}#${index}`,
  type: "BitstringStatusListEntry" as const,
  statusPurpose: "revocation" as const,
  statusListIndex: String(index),
  statusListCredential: statusListUrl(),
});

/**
 * Pack the retired indices into a gzipped bitstring, most significant bit
 * first within each byte, as the spec requires.
 */
export const encodeStatusList = (retiredIndices: readonly number[]): string => {
  const bits = new Uint8Array(LIST_BYTES);
  for (const index of retiredIndices) {
    if (index < 0 || index >= LIST_BYTES * 8) throw new Error(`status list index out of range: ${index}`);
    bits[index >>> 3]! |= 0b1000_0000 >>> (index & 7);
  }
  return Buffer.from(gzipSync(bits)).toString("base64url");
};

/**
 * A credit's index is the one it was ISSUED with, allocated atomically from a
 * database sequence before the credential was signed.
 *
 * It used to be derived from position in issuance order. That held only while
 * issuance was serial: two concurrent issuances both read the same count, both
 * embedded the same index, and retiring one then set the bit the other
 * credential pointed at - leaving a retired credit verifying as live under our
 * own signature. The credential commits to this number, so it has to be read
 * back, never recomputed.
 */
export const statusListIndexOf = (credits: readonly CreditRecord[], creditId: string): number => {
  const credit = credits.find((c) => c.creditId === creditId);
  if (!credit) throw new Error(`no such credit: ${creditId}`);
  return credit.statusListIndex;
};

/** The status list itself, as a Verifiable Credential. */
export const statusListCredentialPayload = (credits: readonly CreditRecord[], issuerDid: string) => ({
  "@context": ["https://www.w3.org/2018/credentials/v1"],
  id: statusListUrl(),
  type: ["VerifiableCredential", "BitstringStatusListCredential"],
  issuer: issuerDid,
  issuanceDate: new Date().toISOString(),
  credentialSubject: {
    id: `${statusListUrl()}#list`,
    type: "BitstringStatusList",
    statusPurpose: "revocation",
    /* The bit a holder checks is the one their credential names, which is the
       index allocated at issuance - never the row's position here. Position
       stops matching the moment anything is issued in parallel or a refusal
       burns a sequence value, and then a retired credit reads as live. */
    encodedList: encodeStatusList(
      credits.flatMap((credit) => (credit.status === "retired" ? [credit.statusListIndex] : [])),
    ),
  },
});

/** The same list, signed, so the list itself cannot be forged in transit. */
export const signStatusListCredential = async (
  credits: readonly CreditRecord[],
  issuer: Issuer,
): Promise<string> => {
  const credential = statusListCredentialPayload(credits, issuer.did);
  return createVerifiableCredentialJwt(
    {
      sub: credential.credentialSubject.id,
      nbf: Math.floor(Date.now() / 1000),
      vc: {
        "@context": credential["@context"],
        type: credential.type,
        credentialSubject: credential.credentialSubject,
      },
    },
    issuer,
  );
};
