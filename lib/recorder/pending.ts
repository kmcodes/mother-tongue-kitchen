import type { ChunkStore } from "@/lib/recorder/chunk-store";
import { joinChunks } from "@/lib/recorder/join";

export const MIN_SECONDS = 2;
export type Uploader = (blob: Blob, durationSec: number) => Promise<{ recipeId: string }>;
export type FinishResult = { ok: true; recipeId: string } | { ok: false; reason: "too_short" | "empty" | "upload_failed" };

export async function finishRecording(store: ChunkStore, sessionId: string, durationSec: number, upload: Uploader): Promise<FinishResult> {
  const data = await store.read(sessionId);
  const blob = data ? joinChunks(data.chunks, data.mimeType) : null;
  if (!blob || blob.size === 0) { await store.discard(sessionId); return { ok: false, reason: "empty" }; }
  if (durationSec < MIN_SECONDS) { await store.discard(sessionId); return { ok: false, reason: "too_short" }; }
  try {
    const { recipeId } = await upload(blob, durationSec);
    await store.discard(sessionId);
    return { ok: true, recipeId };
  } catch {
    return { ok: false, reason: "upload_failed" };
  }
}

// Duration of a recovered session is unknown, so assume it passed the minimum.
export async function uploadPending(store: ChunkStore, upload: Uploader): Promise<number> {
  let ok = 0;
  for (const id of await store.listUnfinished()) {
    const r = await finishRecording(store, id, MIN_SECONDS, upload);
    if (r.ok) ok++;
  }
  return ok;
}
