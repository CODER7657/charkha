import type { FieldEvidence } from "@charkha/core";

/**
 * OWNER: Hem
 *
 * Offline queue. If the submission cannot reach the server - wifi off, the
 * demo beat - it is held in localStorage and retried. The verifier is
 * idempotent on evidenceId, so a retry of something that did land is safe.
 *
 * Network failures and server errors are queued: the gateway answers 500
 * when an agent is restarting, and field evidence must not be lost to that.
 * A 4xx means the server looked at the payload and refused it - retrying
 * that forever would be a lie, so it goes straight back to the user. Server
 * errors are retried a bounded number of times so one poisoned item cannot
 * sit in the queue forever.
 */

export type QueueItem = { evidence: FieldEvidence; queuedAt: string; attempts: number; lastError: string };

export type Send = (evidence: FieldEvidence) => Promise<unknown>;

export type SubmitResult =
  | { status: "sent"; result: unknown }
  | { status: "queued"; error: string }
  | { status: "failed"; error: string };

export type FlushReport = { sent: Array<{ evidenceId: string; result: unknown }>; failed: Array<{ evidenceId: string; error: string }> };

type KV = Pick<Storage, "getItem" | "setItem">;

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Server-error retries per item before giving up. Being offline never counts against this. */
export const MAX_ATTEMPTS = 10;

/** fetch throws TypeError when there is no network at all. */
const isOffline = (err: unknown): boolean => err instanceof TypeError;

export const isRetryable = (err: unknown): boolean =>
  isOffline(err) || /HTTP (408|429|5\d\d)\b/.test(message(err));

export class EvidenceQueue {
  private flushing = false;

  constructor(
    private readonly store: KV,
    private readonly key = "charkha.field.queue.v1",
  ) {}

  list(): QueueItem[] {
    try {
      const parsed = JSON.parse(this.store.getItem(this.key) ?? "[]") as unknown;
      return Array.isArray(parsed) ? (parsed as QueueItem[]) : [];
    } catch {
      return [];
    }
  }

  private save(items: QueueItem[]) {
    this.store.setItem(this.key, JSON.stringify(items));
  }

  private enqueue(evidence: FieldEvidence, error: string) {
    const items = this.list().filter((i) => i.evidence.evidenceId !== evidence.evidenceId);
    items.push({ evidence, queuedAt: new Date().toISOString(), attempts: 1, lastError: error });
    this.save(items);
  }

  async submit(evidence: FieldEvidence, send: Send): Promise<SubmitResult> {
    try {
      return { status: "sent", result: await send(evidence) };
    } catch (err) {
      if (!isRetryable(err)) return { status: "failed", error: message(err) };
      this.enqueue(evidence, message(err));
      return { status: "queued", error: message(err) };
    }
  }

  /**
   * Retry everything, oldest first. Stops at the first offline failure - the
   * rest would fail the same way. A server error on one item moves on to the next.
   */
  async flush(send: Send): Promise<FlushReport> {
    const report: FlushReport = { sent: [], failed: [] };
    if (this.flushing) return report;
    this.flushing = true;
    try {
      for (const item of this.list()) {
        const id = item.evidence.evidenceId;
        const drop = () => this.save(this.list().filter((i) => i.evidence.evidenceId !== id));
        try {
          const result = await send(item.evidence);
          drop();
          report.sent.push({ evidenceId: id, result });
        } catch (err) {
          if (isOffline(err)) {
            this.save(this.list().map((i) => (i.evidence.evidenceId === id ? { ...i, lastError: message(err) } : i)));
            break;
          }
          if (!isRetryable(err)) {
            drop();
            report.failed.push({ evidenceId: id, error: message(err) });
            continue;
          }
          const attempts = item.attempts + 1;
          if (attempts >= MAX_ATTEMPTS) {
            drop();
            report.failed.push({ evidenceId: id, error: `gave up after ${attempts} attempts: ${message(err)}` });
            continue;
          }
          this.save(this.list().map((i) => (i.evidence.evidenceId === id ? { ...i, attempts, lastError: message(err) } : i)));
        }
      }
    } finally {
      this.flushing = false;
    }
    return report;
  }
}
