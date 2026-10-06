import { NextResponse, after } from "next/server";
import { requireEnv } from "@/lib/env";
import { buildDeps } from "@/lib/deps";
import { completeTranscription } from "@/lib/pipeline";
import { verifyWebhookToken } from "@/lib/webhook-auth";

export async function POST(request: Request) {
  if (!verifyWebhookToken(request.headers.get("x-sarvam-job-callback-token"), requireEnv("SARVAM_WEBHOOK_TOKEN"))) {
    return new NextResponse("Forbidden", { status: 403 });
  }
  const payload = (await request.json().catch(() => null)) as { job_id?: string; job_state?: string } | null;
  if (!payload?.job_id) return NextResponse.json({ ok: true });
  if (payload.job_state === "Completed" || payload.job_state === "Failed") {
    const jobId = payload.job_id;
    after(() => completeTranscription(buildDeps(), jobId));
  }
  return NextResponse.json({ ok: true });
}
