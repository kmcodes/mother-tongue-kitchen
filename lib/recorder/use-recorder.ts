"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { createAppendQueue } from "@/lib/recorder/append-queue";
import { createChunkStore, type ChunkStore } from "@/lib/recorder/chunk-store";
import { stopRecorder } from "@/lib/recorder/stop-recorder";
import { createStopwatch } from "@/lib/recorder/stopwatch";

export type RecorderState = "idle" | "recording" | "paused" | "stopped" | "error";

function pickMime(): string {
  for (const t of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"]) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t)) return t;
  }
  return "";
}

export function useRecorder() {
  const [state, setState] = useState<RecorderState>("idle");
  const [seconds, setSeconds] = useState(0);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const storeRef = useRef<ChunkStore | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const sessionRef = useRef<string>("");
  const wakeRef = useRef<WakeLockSentinel | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const watchRef = useRef(createStopwatch());
  const queueRef = useRef(createAppendQueue());

  const store = useCallback(() => (storeRef.current ??= createChunkStore()), []);

  const start = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = pickMime();
      const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      const id = crypto.randomUUID();
      sessionRef.current = id;
      await store().begin(id, rec.mimeType || mimeType || "audio/webm");
      let seq = 0;
      queueRef.current = createAppendQueue();
      rec.ondataavailable = (e) => {
        if (e.data.size === 0) return;
        const mySeq = seq++;
        // Register the write synchronously so stop() can wait for it.
        queueRef.current.add((async () => store().append(id, mySeq, await e.data.arrayBuffer()))());
      };
      rec.start(5000);
      recRef.current = rec;
      try { wakeRef.current = (await navigator.wakeLock?.request("screen")) ?? null; } catch {}
      const ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      ctx.createMediaStreamSource(stream).connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      audioCtxRef.current = ctx;
      watchRef.current = createStopwatch();
      watchRef.current.start();
      setSeconds(0);
      tickRef.current = setInterval(() => {
        analyser.getByteTimeDomainData(data);
        setLevel(Math.max(...data) / 255 - 0.5);
        setSeconds(Math.floor(watchRef.current.elapsedSec()));
      }, 250);
      setState("recording");
    } catch {
      setError("We could not use the microphone. Please allow microphone access and try again.");
      setState("error");
    }
  }, [store]);

  const pause = useCallback(() => { recRef.current?.pause(); watchRef.current.pause(); setState("paused"); }, []);
  const resume = useCallback(() => { recRef.current?.resume(); watchRef.current.resume(); setState("recording"); }, []);

  const stop = useCallback(async () => {
    const rec = recRef.current;
    if (!rec) return null;
    watchRef.current.pause();
    await stopRecorder(rec);
    await queueRef.current.settled();
    rec.stream.getTracks().forEach((t) => t.stop());
    if (tickRef.current) clearInterval(tickRef.current);
    await audioCtxRef.current?.close();
    await wakeRef.current?.release().catch(() => {});
    setState("stopped");
    return { sessionId: sessionRef.current, durationSec: watchRef.current.elapsedSec() };
  }, []);

  useEffect(() => () => { if (tickRef.current) clearInterval(tickRef.current); }, []);

  return { state, seconds, level, error, start, pause, resume, stop, store };
}
