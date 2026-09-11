import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadFirmsCsv } from "./feed.ts";
import { looksLikeCsv, parseCsv } from "./firms.ts";

/* ------------------------------------------------------------------ *
 * The demo must never die on venue wifi. These tests are the proof of
 * that, so they cover the paths we actually expect to hit at the venue:
 * no key, dead network, and a key that has quietly expired.
 * ------------------------------------------------------------------ */

const HEADER =
  "country_id,latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_ti5,frp,daynight";
const SAMPLE = `${HEADER}\nIND,30.8412,75.7692,331.2,0.39,0.36,2026-10-22,0812,N,VIIRS,n,2.0NRT,290.1,12.4,D`;

let dir = "";

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "charkha-firms-"));
  vi.stubEnv("FIRMS_CACHE_DIR", dir);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await fs.rm(dir, { recursive: true, force: true });
});

const writeCached = (name: string, body: string) => fs.writeFile(path.join(dir, name), body, "utf8");

describe("no API key", () => {
  /* THE CACHE-FALLBACK PATH — required by the definition of done. */
  it("falls back to the newest cached response and says so", async () => {
    vi.stubEnv("FIRMS_MAP_KEY", "");
    await writeCached("2026-10-22T00-00-00-000Z.csv", SAMPLE);

    const result = await loadFirmsCsv();

    expect(result.origin).toBe("cache");
    expect(result.note).toContain("FIRMS_MAP_KEY is not set");
    expect(parseCsv(result.csv)).toHaveLength(1);
  });

  it("treats the .env.example placeholder as no key at all", async () => {
    vi.stubEnv("FIRMS_MAP_KEY", "replace_me");
    await writeCached("2026-10-22T00-00-00-000Z.csv", SAMPLE);

    expect((await loadFirmsCsv()).origin).toBe("cache");
  });

  it("never reaches the network without a key", async () => {
    vi.stubEnv("FIRMS_MAP_KEY", "");
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await writeCached("2026-10-22T00-00-00-000Z.csv", SAMPLE);

    await loadFirmsCsv();

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("picks the newest cached response, not just any of them", async () => {
    vi.stubEnv("FIRMS_MAP_KEY", "");
    await writeCached("2026-10-20T00-00-00-000Z.csv", `${HEADER}\nIND,30.1,75.1,331.2,0.39,0.36,2026-10-20,0812,N,VIIRS,n,2.0NRT,290.1,9.0,D`);
    await writeCached("2026-10-22T00-00-00-000Z.csv", SAMPLE);

    const result = await loadFirmsCsv();

    expect(result.note).toContain("2026-10-22T00-00-00-000Z.csv");
    expect(parseCsv(result.csv)[0]?.["acq_date"]).toBe("2026-10-22");
  });

  it("falls through to the bundled sample when there is no cache yet", async () => {
    vi.stubEnv("FIRMS_MAP_KEY", "");

    const result = await loadFirmsCsv();

    expect(result.origin).toBe("fixture");
    expect(looksLikeCsv(result.csv)).toBe(true);
    expect(parseCsv(result.csv).length).toBeGreaterThan(0);
  });
});

describe("the network is against us", () => {
  it("falls back to cache when the fetch throws", async () => {
    vi.stubEnv("FIRMS_MAP_KEY", "a-real-looking-key");
    await writeCached("2026-10-22T00-00-00-000Z.csv", SAMPLE);
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("getaddrinfo ENOTFOUND"));

    const result = await loadFirmsCsv();

    expect(result.origin).toBe("cache");
    expect(result.note).toContain("ENOTFOUND");
  });

  it("falls back when FIRMS answers with an HTTP error", async () => {
    vi.stubEnv("FIRMS_MAP_KEY", "a-real-looking-key");
    await writeCached("2026-10-22T00-00-00-000Z.csv", SAMPLE);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("nope", { status: 503 }));

    const result = await loadFirmsCsv();

    expect(result.origin).toBe("cache");
    expect(result.note).toContain("503");
  });

  /* FIRMS answers a bad key or a blown quota with HTTP 200 and prose. */
  it("does not mistake a 200 error message for data", async () => {
    vi.stubEnv("FIRMS_MAP_KEY", "expired-key");
    await writeCached("2026-10-22T00-00-00-000Z.csv", SAMPLE);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("Invalid MAP_KEY. Please check your key.", { status: 200 }),
    );

    const result = await loadFirmsCsv();

    expect(result.origin).toBe("cache");
    expect(result.note).toContain("non-CSV");
  });
});

describe("a good day", () => {
  it("returns the live response and caches it for the next bad day", async () => {
    vi.stubEnv("FIRMS_MAP_KEY", "a-real-looking-key");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(SAMPLE, { status: 200 }));

    const result = await loadFirmsCsv();

    expect(result.origin).toBe("live");
    const cached = await fs.readdir(dir);
    expect(cached).toHaveLength(1);
    expect(await fs.readFile(path.join(dir, cached[0]!), "utf8")).toBe(SAMPLE);
  });

  it("sends the key and bbox to the documented endpoint", async () => {
    vi.stubEnv("FIRMS_MAP_KEY", "KEY123");
    vi.stubEnv("FIRMS_SOURCE", "VIIRS_SNPP_NRT");
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(SAMPLE, { status: 200 }));

    await loadFirmsCsv({ bbox: "73.8,29.5,77.5,32.2", dayRange: 2 });

    const url = String(fetchSpy.mock.calls[0]?.[0]);
    expect(url).toContain("firms.modaps.eosdis.nasa.gov/api/area/csv/KEY123/VIIRS_SNPP_NRT/");
    expect(fetchSpy.mock.calls[0]?.[1]?.method).toBe("GET");
  });
});
