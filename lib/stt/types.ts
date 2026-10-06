export type Segment = { text: string; start: number; end: number };
export type Transcript = { language: string; text: string; segments: Segment[] };
export type SttState = { state: "pending" } | { state: "failed"; error: string } | { state: "done"; transcript: Transcript };
export interface SttProvider {
  start(audio: { bytes: Uint8Array; filename: string; contentType: string }, opts: { callbackUrl: string; languageHint?: string }): Promise<{ jobId: string }>;
  fetch(jobId: string): Promise<SttState>;
}
