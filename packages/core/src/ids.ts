import { randomUUID, createHash } from "node:crypto";

/** Prefixed, sortable-enough ids. Keep prefixes stable - they show up in the demo UI. */
export const newId = (prefix: string): string => `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 20)}`;

export const sha256Hex = (input: string | Uint8Array): string =>
  createHash("sha256").update(input).digest("hex");

/**
 * Canonical JSON: object keys sorted recursively so that the same logical
 * payload always hashes to the same digest, whichever agent serialised it.
 * Every hash written to the decision log MUST go through this.
 */
export const canonicalJson = (value: unknown): string => {
  const walk = (v: unknown): unknown => {
    if (v === null || typeof v !== "object") return v;
    if (Array.isArray(v)) return v.map(walk);
    return Object.fromEntries(
      Object.keys(v as Record<string, unknown>)
        .sort()
        .map((k) => [k, walk((v as Record<string, unknown>)[k])]),
    );
  };
  return JSON.stringify(walk(value));
};

export const hashPayload = (value: unknown): string => sha256Hex(canonicalJson(value));
