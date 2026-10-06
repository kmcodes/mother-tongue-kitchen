import { NextResponse } from "next/server";
import { requireEnv } from "@/lib/env";
import { buildDeps } from "@/lib/deps";
import { completeTranscription } from "@/lib/pipeline";
import { listStuck } from "@/lib/recipes";

export async function GET(request: Request) {
  if (request.headers.get("authorization") !== `Bearer ${requireEnv("CRON_SECRET")}`) return new NextResponse("Forbidden", { status: 403 });
  const deps = buildDeps();
  const stuck = await listStuck(deps.db, 5);
  const results: string[] = [];
  for (const r of stuck) results.push(await completeTranscription(deps, r.stt_job_id));
  return NextResponse.json({ checked: stuck.length, results });
}
