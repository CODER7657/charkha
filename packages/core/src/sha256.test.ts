import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { sha256Hex } from "./ids.ts";

/* Known-answer vectors. A hand-written hash function is only trustworthy if
   it is pinned to the published answers and to node's own implementation. */

const hex = (s: string) => sha256Hex(new TextEncoder().encode(s));

describe("sha256", () => {
  it("matches the FIPS 180-4 vectors", () => {
    expect(hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(hex("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")).toBe(
      "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
    );
  });

  it("agrees with node:crypto across message lengths, including every padding edge", () => {
    for (const length of [0, 1, 54, 55, 56, 57, 63, 64, 65, 119, 120, 1000]) {
      const message = "x".repeat(length);
      expect(hex(message), `length ${length}`).toBe(createHash("sha256").update(message).digest("hex"));
    }
  });

  it("handles non-ASCII input the same way node does", () => {
    const message = "ਪਰਾਲੀ / पराली / straw";
    expect(hex(message)).toBe(createHash("sha256").update(message, "utf8").digest("hex"));
  });
});
