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

const statusListUrl = (): string => {
  const base = process.env["REGISTRY_PUBLIC_URL"] ?? process.env["REGISTRY_URL"] ?? "http://localhost:4004";
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
 * A credit's index is its position in issuance order. It is derived rather
 * than stored, which holds because issuance is append-only.
 * TODO: a `status_list_index` column on `credits` would make this explicit -
 * one-line change in packages/db, needs a core PR.
 */
export const statusListIndexOf = (credits: readonly CreditRecord[], creditId: string): number => {
  const index = credits.findIndex((c) => c.creditId === creditId);
  if (index < 0) throw new Error(`no such credit: ${creditId}`);
  return index;
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
    encodedList: encodeStatusList(
      credits.flatMap((credit, index) => (credit.status === "retired" ? [index] : [])),
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
