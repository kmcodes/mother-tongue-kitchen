import { describe, it, expect, vi } from "vitest";
import { createChunkStore } from "@/lib/recorder/chunk-store";
import { finishRecording, uploadPending } from "@/lib/recorder/pending";
const buf = (...n: number[]) => new Uint8Array(n).buffer;
let n = 0;
const fresh = () => createChunkStore(`pending-${n++}`);

describe("finishRecording", () => {
  it("rejects a too-short recording and discards it without uploading", async () => {
    const store = fresh(); const up = vi.fn();
    await store.begin("s", "audio/webm"); await store.append("s", 0, buf(1));
    expect(await finishRecording(store, "s", 1, up)).toEqual({ ok: false, reason: "too_short" });
    expect(up).not.toHaveBeenCalled();
    expect(await store.read("s")).toBeNull();
  });
  it("rejects zero bytes", async () => {
    const store = fresh(); const up = vi.fn();
    await store.begin("s", "audio/webm");
    expect(await finishRecording(store, "s", 30, up)).toEqual({ ok: false, reason: "empty" });
    expect(up).not.toHaveBeenCalled();
  });
  it("keeps the local copy when upload fails, deletes it when it succeeds", async () => {
    const store = fresh();
    await store.begin("s", "audio/webm"); await store.append("s", 0, buf(1, 2, 3));
    const failing = vi.fn().mockRejectedValue(new Error("offline"));
    expect(await finishRecording(store, "s", 30, failing)).toEqual({ ok: false, reason: "upload_failed" });
    expect(await store.read("s")).not.toBeNull();
    const ok = vi.fn().mockResolvedValue({ recipeId: "r1" });
    expect(await finishRecording(store, "s", 30, ok)).toEqual({ ok: true, recipeId: "r1" });
    expect(await store.read("s")).toBeNull();
  });
});

describe("uploadPending", () => {
  it("re-uploads unfinished sessions and reports how many succeeded", async () => {
    const store = fresh();
    for (const id of ["a", "b"]) { await store.begin(id, "audio/webm"); await store.append(id, 0, buf(1, 2)); }
    const up = vi.fn().mockResolvedValueOnce({ recipeId: "r1" }).mockRejectedValueOnce(new Error("x"));
    expect(await uploadPending(store, up)).toBe(1);
    expect((await store.listUnfinished()).length).toBe(1);
  });
});
