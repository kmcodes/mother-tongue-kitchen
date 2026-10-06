import { describe, it, expect, beforeEach } from "vitest";
import { createChunkStore } from "@/lib/recorder/chunk-store";
const buf = (...n: number[]) => new Uint8Array(n).buffer;
let n = 0;
describe("chunk store", () => {
  let store: ReturnType<typeof createChunkStore>;
  beforeEach(() => { store = createChunkStore(`test-${n++}`); });

  it("returns chunks in sequence order even if written out of order", async () => {
    await store.begin("s1", "audio/webm");
    await store.append("s1", 1, buf(2));
    await store.append("s1", 0, buf(1));
    await store.append("s1", 2, buf(3));
    const r = await store.read("s1");
    expect(r?.mimeType).toBe("audio/webm");
    expect(r?.chunks.map((c) => new Uint8Array(c)[0])).toEqual([1, 2, 3]);
  });
  it("lists unfinished sessions until discarded", async () => {
    await store.begin("a", "audio/webm");
    await store.begin("b", "audio/webm");
    expect((await store.listUnfinished()).sort()).toEqual(["a", "b"]);
    await store.discard("a");
    expect(await store.listUnfinished()).toEqual(["b"]);
    expect(await store.read("a")).toBeNull();
  });
  it("discard removes the chunks too", async () => {
    await store.begin("a", "audio/webm");
    await store.append("a", 0, buf(9));
    await store.discard("a");
    await store.begin("a", "audio/webm");
    expect((await store.read("a"))?.chunks).toEqual([]);
  });
});
