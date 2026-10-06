import { describe, it, expect } from "vitest";
import { createAppendQueue } from "@/lib/recorder/append-queue";
describe("append queue", () => {
  it("settled() waits for slow writes added before it", async () => {
    const q = createAppendQueue();
    let written = false;
    q.add(new Promise<void>((r) => setTimeout(() => { written = true; r(); }, 50)));
    await q.settled();
    expect(written).toBe(true);
  });
  it("settled() resolves even if a write fails, and with nothing queued", async () => {
    const q = createAppendQueue();
    await q.settled();
    q.add(Promise.reject(new Error("disk full"))).catch(() => {});
    await expect(q.settled()).resolves.toBeUndefined();
  });
});
