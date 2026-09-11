import { describe, expect, it } from "vitest";
import { memoizeAsync, serialized } from "./serial.ts";

const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("serialized - onnxruntime-web must never be entered concurrently", () => {
  it("runs overlapping calls strictly one after another", async () => {
    const serial = serialized();
    let inFlight = 0;
    let maxInFlight = 0;
    const order: string[] = [];
    const job = (id: string, ms: number) =>
      serial(async () => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        order.push(`${id}:start`);
        await tick(ms);
        order.push(`${id}:end`);
        inFlight--;
        return id;
      });

    const results = await Promise.all([job("a", 15), job("b", 1), job("c", 5)]);
    expect(results).toEqual(["a", "b", "c"]);
    expect(maxInFlight).toBe(1);
    expect(order).toEqual(["a:start", "a:end", "b:start", "b:end", "c:start", "c:end"]);
  });

  it("a failed call does not block the ones queued behind it", async () => {
    const serial = serialized();
    const failed = serial(async () => {
      throw new Error("webgpu EP unavailable");
    });
    const next = serial(async () => "wasm ok");
    await expect(failed).rejects.toThrow("webgpu EP unavailable");
    await expect(next).resolves.toBe("wasm ok");
  });
});

describe("memoizeAsync - the model loads once however many times the view mounts", () => {
  it("shares one in-flight load between concurrent callers", async () => {
    let calls = 0;
    const load = memoizeAsync(async () => {
      calls++;
      await tick(5);
      return { hash: "abc" };
    });
    const [a, b] = await Promise.all([load(), load()]);
    expect(calls).toBe(1);
    expect(a).toBe(b);
  });

  it("allows a retry after a failed load", async () => {
    let calls = 0;
    const load = memoizeAsync(async () => {
      calls++;
      if (calls === 1) throw new Error("offline");
      return "model";
    });
    await expect(load()).rejects.toThrow("offline");
    await expect(load()).resolves.toBe("model");
    expect(calls).toBe(2);
  });
});
