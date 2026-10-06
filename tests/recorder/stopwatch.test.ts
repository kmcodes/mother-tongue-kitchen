import { describe, it, expect } from "vitest";
import { createStopwatch } from "@/lib/recorder/stopwatch";
describe("stopwatch", () => {
  it("measures real elapsed time even if nobody ticks, and excludes paused time", () => {
    let t = 1000;
    const sw = createStopwatch(() => t);
    sw.start();
    t += 10_000; // 10 s with no timer ticks (background tab)
    expect(sw.elapsedSec()).toBe(10);
    sw.pause();
    t += 60_000; // paused
    expect(sw.elapsedSec()).toBe(10);
    sw.resume();
    t += 2_500;
    expect(sw.elapsedSec()).toBe(12.5);
  });
});
