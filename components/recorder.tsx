"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useRecorder } from "@/lib/recorder/use-recorder";
import { finishRecording } from "@/lib/recorder/pending";
import { uploadRecording } from "@/lib/upload-recording";

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

export function Recorder() {
  const r = useRecorder();
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function onStop() {
    setBusy(true);
    const done = await r.stop();
    if (!done) { setBusy(false); return; }
    const res = await finishRecording(r.store(), done.sessionId, done.durationSec, uploadRecording);
    if (res.ok) { router.push("/"); return; }
    setBusy(false);
    if (res.reason === "upload_failed") setMessage("Saved on this phone. It will upload when you are back online.");
    else setMessage("That was too short, try again.");
  }

  return (
    <div className="flex flex-col items-center gap-6 p-6">
      <div className="text-5xl font-mono tabular-nums">{fmt(r.seconds)}</div>
      <div className="h-2 w-48 overflow-hidden rounded bg-neutral-200"><div className="h-full bg-red-500 transition-all" style={{ width: `${Math.min(100, Math.max(0, r.level * 300))}%` }} /></div>
      {r.state === "idle" && <button onClick={r.start} className="h-24 w-24 rounded-full bg-red-600 text-white shadow-lg" aria-label="Start recording">Record</button>}
      {r.state === "recording" && (
        <div className="flex gap-4">
          <button onClick={r.pause} className="rounded border px-6 py-3">Pause</button>
          <button onClick={onStop} disabled={busy} className="rounded bg-black px-6 py-3 text-white">Stop</button>
        </div>
      )}
      {r.state === "paused" && (
        <div className="flex gap-4">
          <button onClick={r.resume} className="rounded border px-6 py-3">Resume</button>
          <button onClick={onStop} disabled={busy} className="rounded bg-black px-6 py-3 text-white">Stop</button>
        </div>
      )}
      {r.state === "recording" && <p className="text-sm text-neutral-600">Recording. Keep this screen open.</p>}
      {r.error && <p className="text-sm text-red-600">{r.error}</p>}
      {message && <p className="text-sm">{message}</p>}
    </div>
  );
}
