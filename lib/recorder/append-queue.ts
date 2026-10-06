// Tracks in-flight chunk writes so stop() can wait for the real last write, not a guessed delay.
export function createAppendQueue() {
  const pending = new Set<Promise<unknown>>();
  return {
    add<T>(p: Promise<T>): Promise<T> {
      pending.add(p);
      const done = () => { pending.delete(p); };
      p.then(done, done);
      return p;
    },
    async settled(): Promise<void> {
      while (pending.size > 0) await Promise.allSettled([...pending]);
    },
  };
}
