// Throwaway spike: run one audio file through Sarvam batch STT and print what comes back.
// usage: npx tsx scripts/sarvam-spike.ts <audio> [--lang hi-IN] [--terms jeera,hing] [--model saaras:v4] [--no-timestamps]
import { SarvamAIClient } from "sarvamai";
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--") && !args[args.indexOf(a) - 1]?.startsWith("--"));
const opt = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
if (!file) throw new Error("usage: tsx scripts/sarvam-spike.ts <audio> [--lang hi-IN] [--terms a,b] [--model saaras:v4] [--no-timestamps]");
const key = process.env.SARVAM_API_KEY;
if (!key) throw new Error("SARVAM_API_KEY missing (source .env.local first)");

const lang = opt("lang") ?? "unknown";
const terms = opt("terms")?.split(",").map((t) => t.trim()).filter(Boolean);
const model = (opt("model") ?? "saaras:v4") as "saaras:v4" | "saaras:v3";
const withTimestamps = !args.includes("--no-timestamps");

async function main() {
  const client = new SarvamAIClient({ apiSubscriptionKey: key! });
  const t0 = Date.now();
  const job = await client.speechToTextJob.createJob({
    model,
    mode: "transcribe",
    withTimestamps,
    languageCode: lang as never,
    ...(terms?.length && model === "saaras:v4" ? { keyterms: terms } : {}),
  });
  console.log("job", job.jobId);
  await job.uploadFiles([path.resolve(file!)]);
  await job.start();
  await job.waitUntilComplete(5, 1800);
  const seconds = Math.round((Date.now() - t0) / 1000);

  const results = await job.getFileResults();
  if (results.failed.length) { console.log("FAILED:", JSON.stringify(results.failed, null, 2)); process.exit(1); }

  const out = path.join("spike-audio", "out", `${path.basename(file!)}${terms?.length ? ".keyterms" : ""}`);
  fs.mkdirSync(out, { recursive: true });
  await job.downloadOutputs(out);
  const jsonFile = fs.readdirSync(out).find((f) => f.endsWith(".json"));
  if (!jsonFile) { console.log("no json output in", out); return; }
  const o = JSON.parse(fs.readFileSync(path.join(out, jsonFile), "utf8"));

  const chunks: string[] = o.timestamps?.chunks ?? [];
  const starts: number[] = o.timestamps?.start_time_seconds ?? [];
  const ends: number[] = o.timestamps?.end_time_seconds ?? [];
  const lens = chunks.map((c, i) => (ends[i] ?? 0) - (starts[i] ?? 0));
  const words = chunks.map((c) => c.trim().split(/\s+/).length);
  console.log("---");
  console.log("model:", model, "| timestamps requested:", withTimestamps, "| keyterms:", terms?.join(",") ?? "none");
  console.log("processing time (s):", seconds);
  console.log("language_code:", o.language_code);
  console.log("transcript chars:", (o.transcript ?? "").length);
  console.log("chunks:", chunks.length, "| avg words/chunk:", chunks.length ? (words.reduce((a, b) => a + b, 0) / chunks.length).toFixed(1) : "-");
  console.log("chunk seconds min/avg/max:", lens.length ? [Math.min(...lens), lens.reduce((a, b) => a + b, 0) / lens.length, Math.max(...lens)].map((n) => n.toFixed(1)).join(" / ") : "-");
  console.log("looks word-level (avg <= 1.5 words/chunk):", chunks.length > 0 && words.reduce((a, b) => a + b, 0) / chunks.length <= 1.5);
  console.log("top-level keys:", Object.keys(o).join(", "));
  console.log("first 300 chars:", (o.transcript ?? "").slice(0, 300));
  console.log("saved:", path.join(out, jsonFile));
}
main().catch((e) => { console.error(e); process.exit(1); });
