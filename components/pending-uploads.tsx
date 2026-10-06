"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createChunkStore } from "@/lib/recorder/chunk-store";
import { uploadPending } from "@/lib/recorder/pending";
import { uploadRecording } from "@/lib/upload-recording";

export function PendingUploads() {
  const router = useRouter();
  const [count, setCount] = useState(0);
  const [busy, setBusy] = useState(false);
  useEffect(() => { createChunkStore().listUnfinished().then((l) => setCount(l.length)).catch(() => {}); }, []);
  if (count === 0) return null;
  return (
    <div className="rounded border border-amber-300 bg-amber-50 p-4 text-sm">
      <p>{count} recording{count > 1 ? "s" : ""} saved on this phone and not uploaded yet.</p>
      <button disabled={busy} className="mt-2 rounded bg-black px-4 py-2 text-white" onClick={async () => {
        setBusy(true);
        await uploadPending(createChunkStore(), uploadRecording);
        setCount((await createChunkStore().listUnfinished()).length);
        setBusy(false);
        router.refresh();
      }}>Upload now</button>
    </div>
  );
}
