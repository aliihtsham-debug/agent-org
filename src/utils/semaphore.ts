/**
 * Concurrency-limiting semaphore.
 *
 * Limits the number of concurrent async operations — useful for preventing
 * API rate limits by capping simultaneous calls to an external service.
 *
 * Usage:
 *   const sem = new Semaphore(5); // max 5 concurrent
 *   await sem.acquire();
 *   try {
 *     await doWork();
 *   } finally {
 *     sem.release();
 *   }
 *
 * Or with the convenience wrapper:
 *   await sem.run(() => doWork());
 */
export class Semaphore {
  private permits: number;
  private queue: Array<() => void> = [];

  constructor(permits: number) {
    this.permits = Math.max(1, permits);
  }

  /** Acquire a permit. Waits if none are available. */
  acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits--;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.queue.push(resolve);
    });
  }

  /** Release a permit, waking the next waiter if any. */
  release(): void {
    if (this.queue.length > 0) {
      const next = this.queue.shift();
      // Keep the permit count the same: transfer directly to waiter
      next?.();
    } else {
      this.permits++;
    }
  }

  /** Run a function under the semaphore, auto-releasing when done. */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  /** Number of permits currently available. */
  available(): number {
    return this.permits;
  }

  /** Number of tasks waiting for a permit. */
  waiting(): number {
    return this.queue.length;
  }
}
