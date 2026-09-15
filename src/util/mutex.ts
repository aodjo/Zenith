/**
 * A minimal FIFO async mutex.
 *
 * Serializes asynchronous operations so that only one runs at a time and waiting callers
 * proceed in the order they arrived. Zenith drives a single shared screen by injecting
 * taps, so two operations running at once would interleave their taps and corrupt each
 * other; every UI operation is therefore run through one mutex, forming an operation
 * queue.
 *
 * @example
 * const mutex = new Mutex();
 * await Promise.all([
 *   mutex.runExclusive(() => join(roomA)),
 *   mutex.runExclusive(() => join(roomB)), // starts only after roomA finishes
 * ]);
 */
export class Mutex {
  private tail: Promise<unknown> = Promise.resolve();

  /**
   * Runs a function once all previously queued functions have settled.
   *
   * Callers are released in arrival order (FIFO). A rejection from one caller does not
   * break the queue: later callers still run. The returned promise settles with the
   * function's own result or error.
   *
   * @template T
   * @param {() => Promise<T>} fn - The exclusive critical section to run.
   * @returns {Promise<T>} Resolves or rejects with `fn`'s outcome.
   *
   * @example
   * const value = await mutex.runExclusive(async () => 42);
   */
  runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.tail.then(() => fn());
    this.tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}
