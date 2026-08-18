/**
 * Counting semaphore with abort support — gates concurrent harness sessions
 * on the shared sandbox's bridge-port pool (SPEC §6.1).
 */
export class Semaphore {
  private available: number;
  private readonly queue: {
    resolve: (release: () => void) => void;
    reject: (err: Error) => void;
    signal?: AbortSignal;
  }[] = [];

  constructor(slots: number) {
    this.available = Math.max(1, slots);
  }

  acquire(signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted) {
      return Promise.reject(new DOMException("Aborted", "AbortError"));
    }
    if (this.available > 0) {
      this.available--;
      return Promise.resolve(this.makeRelease());
    }
    return new Promise<() => void>((resolve, reject) => {
      const entry = { resolve, reject, signal };
      this.queue.push(entry);
      signal?.addEventListener(
        "abort",
        () => {
          const index = this.queue.indexOf(entry);
          if (index >= 0) {
            this.queue.splice(index, 1);
            reject(new DOMException("Aborted", "AbortError"));
          }
        },
        { once: true },
      );
    });
  }

  private makeRelease(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = this.queue.shift();
      if (next) {
        next.resolve(this.makeRelease());
      } else {
        this.available++;
      }
    };
  }
}
