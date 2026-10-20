/**
 * Abort-aware FIFO concurrency limiter. Used to cap concurrent ModelArk streams/calls so the
 * plan's concurrency/RPM limits queue work instead of returning 429s. Excess callers wait in
 * order; an aborted waiter leaves the queue without ever holding a slot; the release function
 * is idempotent and hands the slot straight to the next waiter.
 */
export class Semaphore {
  private avail: number;
  private waiters: Array<{ resolve: () => void; signal?: AbortSignal; onAbort?: () => void }> = [];
  constructor(n: number) {
    this.avail = Math.max(1, n);
  }
  async acquire(signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted) throw new Error('aborted before acquiring a model slot');
    if (this.avail > 0) {
      this.avail--;
    } else {
      await new Promise<void>((resolve, reject) => {
        const w: { resolve: () => void; signal?: AbortSignal; onAbort?: () => void } = { resolve, signal };
        w.onAbort = () => {
          const i = this.waiters.indexOf(w);
          if (i >= 0) this.waiters.splice(i, 1); // never granted a slot → nothing to return
          reject(new Error('aborted while queued for a model slot'));
        };
        if (signal) signal.addEventListener('abort', w.onAbort, { once: true });
        this.waiters.push(w);
      });
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = this.waiters.shift();
      if (next) {
        if (next.signal && next.onAbort) next.signal.removeEventListener('abort', next.onAbort);
        next.resolve(); // hand the slot directly to the next waiter (avail stays consumed)
      } else {
        this.avail++;
      }
    };
  }
}
