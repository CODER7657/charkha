import type { FieldEvidence } from "@charkha/core";

/**
 * OWNER: Hem
 *
 * Offline queue. If the submission cannot reach the server - wifi off, the
 * demo beat - it is held in localStorage and retried. The verifier is
 * idempotent on evidenceId, so a retry of something that did land is safe.
 *
 * Only network-shaped failures are queued. If the server answered and said
 * no, retrying forever would be a lie; that error goes back to the user.
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

/**
 * fetch throws TypeError when there is no network at all. A gateway or proxy
 * that cannot reach upstream answers 502/503/504. Everything else means the
 * server saw the payload and made a decision about it.
 */
export const isRetryable = (err: unknown): boolean =>
  err instanceof TypeError || /HTTP (408|429|502|503|504)\b/.test(message(err));

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

  /** Retry everything, oldest first. Stops at the first network failure - still offline. */
  async flush(send: Send): Promise<FlushReport> {
    const report: FlushReport = { sent: [], failed: [] };
    if (this.flushing) return report;
    this.flushing = true;
    try {
      for (const item of this.list()) {
        const id = item.evidence.evidenceId;
        try {
          const result = await send(item.evidence);
          this.save(this.list().filter((i) => i.evidence.evidenceId !== id));
          report.sent.push({ evidenceId: id, result });
        } catch (err) {
          if (isRetryable(err)) {
            this.save(this.list().map((i) => (i.evidence.evidenceId === id ? { ...i, attempts: i.attempts + 1, lastError: message(err) } : i)));
            break;
          }
          this.save(this.list().filter((i) => i.evidence.evidenceId !== id));
          report.failed.push({ evidenceId: id, error: message(err) });
        }
      }
    } finally {
      this.flushing = false;
    }
    return report;
  }
}
