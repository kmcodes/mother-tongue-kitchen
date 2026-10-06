import { SarvamAIClient } from "sarvamai";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { requireEnv } from "@/lib/env";
import type { SttProvider, SttState, Transcript } from "@/lib/stt/types";

export function parseSarvamOutput(raw: unknown): Transcript {
  const o = (raw ?? {}) as {
    transcript?: string | null;
    language_code?: string | null;
    timestamps?: { chunks?: string[]; start_time_seconds?: number[]; end_time_seconds?: number[] };
  };
  const chunks = o.timestamps?.chunks ?? [];
  const starts = o.timestamps?.start_time_seconds ?? [];
  const ends = o.timestamps?.end_time_seconds ?? [];
  let segments = chunks
    .map((text, i) => ({ text: text.trim(), start: starts[i] ?? 0, end: ends[i] ?? 0 }))
    .filter((s) => s.text.length > 0);
  const text = (o.transcript ?? segments.map((s) => s.text).join(" ")).trim();
  if (segments.length === 0 && text) segments = [{ text, start: 0, end: 0 }];
  return { language: o.language_code ?? "unknown", text, segments };
}

// Call names follow the installed sarvamai SDK types (v1.x). Behaviour is confirmed by the Task 1 spike.
export function createSarvamProvider(): SttProvider {
  const client = () => new SarvamAIClient({ apiSubscriptionKey: requireEnv("SARVAM_API_KEY") });
  return {
    async start(audio, opts) {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mtk-"));
      const file = path.join(dir, audio.filename);
      await fs.writeFile(file, audio.bytes);
      try {
        const job = await client().speechToTextJob.createJob({
          model: "saaras:v4",
          mode: "transcribe",
          withTimestamps: true,
          ...(opts.languageHint ? { languageCode: opts.languageHint as never } : {}),
          callback: { url: opts.callbackUrl, auth_token: requireEnv("SARVAM_WEBHOOK_TOKEN") },
        });
        await job.uploadFiles([file]);
        await job.start();
        return { jobId: job.jobId };
      } finally {
        await fs.rm(dir, { recursive: true, force: true });
      }
    },
    async fetch(jobId): Promise<SttState> {
      const job = client().speechToTextJob.getJob(jobId);
      const status = await job.getStatus();
      if (status.job_state === "Failed") return { state: "failed", error: status.error_message || "Transcription failed" };
      if (status.job_state !== "Completed") return { state: "pending" };
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mtk-out-"));
      try {
        await job.downloadOutputs(dir);
        const name = (await fs.readdir(dir)).find((f) => f.endsWith(".json"));
        if (!name) return { state: "failed", error: "No transcript file returned" };
        return { state: "done", transcript: parseSarvamOutput(JSON.parse(await fs.readFile(path.join(dir, name), "utf8"))) };
      } finally {
        await fs.rm(dir, { recursive: true, force: true });
      }
    },
  };
}
