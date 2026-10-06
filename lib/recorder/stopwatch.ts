// Wall-clock elapsed time, so throttled timers in a background tab cannot shorten the duration.
export function createStopwatch(now: () => number = () => Date.now()) {
  let acc = 0;
  let startedAt: number | null = null;
  return {
    start() { acc = 0; startedAt = now(); },
    pause() { if (startedAt !== null) { acc += now() - startedAt; startedAt = null; } },
    resume() { if (startedAt === null) startedAt = now(); },
    elapsedSec() { return (acc + (startedAt === null ? 0 : now() - startedAt)) / 1000; },
  };
}
