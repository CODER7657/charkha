/**
 * OWNER: Hem
 *
 * onnxruntime-web's WebGPU build runs on an asyncify wasm instance, which is
 * NOT re-entrant: if one call is suspended awaiting the GPU and a second call
 * enters the same instance (another session create, another run), the tab
 * hangs hard - no error, no recovery. Reproduced by loading the model twice
 * at once (React StrictMode does exactly that in dev).
 *
 * So every call into ort goes through one serial queue, and the model is
 * loaded once and shared.
 */

/** Returns a runner that executes async jobs strictly one at a time, in order. */
export const serialized = () => {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(job: () => Promise<T>): Promise<T> => {
    const run = tail.then(job, job);
    tail = run.catch(() => undefined);
    return run;
  };
};

/** One shared in-flight/settled promise; a failure clears it so a retry can load again. */
export const memoizeAsync = <T>(load: () => Promise<T>): (() => Promise<T>) => {
  let pending: Promise<T> | null = null;
  return () => {
    pending ??= load().catch((err: unknown) => {
      pending = null;
      throw err;
    });
    return pending;
  };
};
