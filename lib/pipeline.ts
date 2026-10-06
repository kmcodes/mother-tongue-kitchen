import type { Db } from "@/lib/db";
import type { LlmClient } from "@/lib/llm";
import { getRecipeByJobId, getRecipeById, getRecipeForOwner } from "@/lib/recipes";
import { structureRecipe } from "@/lib/structure";
import type { SttProvider } from "@/lib/stt/types";

export type PipelineDeps = {
  db: Db;
  stt: SttProvider;
  llm: LlmClient;
  readAudio(pathname: string): Promise<{ bytes: Uint8Array; filename: string; contentType: string }>;
  callbackUrl: string;
};

export async function startTranscription(deps: PipelineDeps, recipeId: string): Promise<void> {
  const { db } = deps;
  const claimed = await db.query("update recipes set status = 'transcribing', error = null, updated_at = now() where id = $1 and status in ('uploaded','failed') returning id", [recipeId]);
  if (claimed.length === 0) return;
  await db.query("delete from segments where recipe_id = $1", [recipeId]);
  const recipe = await getRecipeById(db, recipeId);
  try {
    const audio = await deps.readAudio(recipe!.audio_pathname);
    const { jobId } = await deps.stt.start(audio, { callbackUrl: deps.callbackUrl });
    await db.query("update recipes set stt_job_id = $2, updated_at = now() where id = $1", [recipeId, jobId]);
  } catch (e) {
    await db.query("update recipes set status = 'failed', error = $2, updated_at = now() where id = $1", [recipeId, (e as Error).message.slice(0, 300)]);
  }
}

export async function completeTranscription(deps: PipelineDeps, jobId: string): Promise<"pending" | "ready" | "failed" | "ignored"> {
  const { db } = deps;
  const recipe = await getRecipeByJobId(db, jobId);
  if (!recipe || recipe.status !== "transcribing") return "ignored";
  const state = await deps.stt.fetch(jobId);
  if (state.state === "pending") return "pending";
  if (state.state === "failed") {
    await db.query("update recipes set status = 'failed', error = $2, updated_at = now() where id = $1 and status = 'transcribing'", [recipe.id, state.error.slice(0, 300)]);
    return "failed";
  }
  // Atomic claim: only one caller moves transcribing -> structuring.
  const claimed = await db.query("update recipes set status = 'structuring', updated_at = now() where id = $1 and status = 'transcribing' returning id", [recipe.id]);
  if (claimed.length === 0) return "ignored";

  const { transcript } = state;
  for (const [i, s] of transcript.segments.entries()) {
    await db.query("insert into segments (recipe_id, idx, text, start_sec, end_sec) values ($1, $2, $3, $4, $5) on conflict do nothing", [recipe.id, i, s.text, s.start, s.end]);
  }
  if (!transcript.text) {
    await db.query("update recipes set status = 'ready', note = 'no_speech', language = $2, transcript_text = '', updated_at = now() where id = $1", [recipe.id, transcript.language]);
    return "ready";
  }
  try {
    const r = await structureRecipe(transcript.text, deps.llm);
    await db.query(
      "update recipes set status = 'ready', title = $2, ingredients = $3::jsonb, steps = $4::jsonb, language = $5, transcript_text = $6, updated_at = now() where id = $1",
      [recipe.id, r.title, JSON.stringify(r.ingredients), JSON.stringify(r.steps), transcript.language, transcript.text],
    );
  } catch {
    await db.query("update recipes set status = 'ready', note = 'structure_failed', language = $2, transcript_text = $3, updated_at = now() where id = $1", [recipe.id, transcript.language, transcript.text]);
  }
  return "ready";
}

export async function retryRecipe(deps: PipelineDeps, recipeId: string, ownerId: string): Promise<boolean> {
  const recipe = await getRecipeForOwner(deps.db, recipeId, ownerId);
  if (!recipe || recipe.status !== "failed") return false;
  await startTranscription(deps, recipeId);
  return true;
}

// Rescues recipes stranded by a crashed or timed-out function. Anything it cannot safely resume
// is marked failed so the Retry button appears.
export async function recoverStale(deps: PipelineDeps, olderThanMinutes: number): Promise<{ restarted: number; failed: number }> {
  const { db } = deps;
  const age = "updated_at < now() - ($1 || ' minutes')::interval";
  const minutes = String(olderThanMinutes);
  const uploaded = await db.query<{ id: string }>(`select id from recipes where status = 'uploaded' and ${age}`, [minutes]);
  for (const r of uploaded) await startTranscription(deps, r.id);
  const failed = await db.query(
    `update recipes set status = 'failed', error = 'Interrupted. Tap Retry.', updated_at = now()
     where ((status = 'transcribing' and stt_job_id is null) or status = 'structuring') and ${age} returning id`,
    [minutes],
  );
  return { restarted: uploaded.length, failed: failed.length };
}
