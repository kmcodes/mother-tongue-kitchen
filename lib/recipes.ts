import type { Db } from "@/lib/db";

export type RecipeStatus = "uploaded" | "transcribing" | "structuring" | "ready" | "failed";
export type Recipe = {
  id: string; owner_id: string; title: string | null; status: RecipeStatus; note: string | null; error: string | null;
  language: string | null; audio_pathname: string; duration_sec: number; stt_job_id: string | null; transcript_text: string | null;
  ingredients: { name: string; quantity?: string }[] | null; steps: string[] | null; created_at: string;
};
export type SegmentRow = { recipe_id: string; idx: number; text: string; edited_text: string | null; start_sec: number; end_sec: number };

const COLS = "id, owner_id, title, status, note, error, language, audio_pathname, duration_sec, stt_job_id, transcript_text, ingredients, steps, created_at";

export async function createRecipe(db: Db, ownerId: string, audioPathname: string, durationSec: number): Promise<Recipe> {
  return (await db.query<Recipe>(`insert into recipes (owner_id, status, audio_pathname, duration_sec) values ($1, 'uploaded', $2, $3) returning ${COLS}`, [ownerId, audioPathname, durationSec]))[0];
}
export async function getRecipeById(db: Db, id: string): Promise<Recipe | null> {
  return (await db.query<Recipe>(`select ${COLS} from recipes where id = $1`, [id]))[0] ?? null;
}
export async function getRecipeForOwner(db: Db, id: string, ownerId: string): Promise<Recipe | null> {
  return (await db.query<Recipe>(`select ${COLS} from recipes where id = $1 and owner_id = $2`, [id, ownerId]))[0] ?? null;
}
export async function getRecipeByJobId(db: Db, jobId: string): Promise<Recipe | null> {
  return (await db.query<Recipe>(`select ${COLS} from recipes where stt_job_id = $1`, [jobId]))[0] ?? null;
}
export async function listRecipes(db: Db, ownerId: string): Promise<Recipe[]> {
  return db.query<Recipe>(`select ${COLS} from recipes where owner_id = $1 order by created_at desc limit 200`, [ownerId]);
}
export async function listSegments(db: Db, recipeId: string): Promise<SegmentRow[]> {
  return db.query<SegmentRow>("select recipe_id, idx, text, edited_text, start_sec, end_sec from segments where recipe_id = $1 order by idx", [recipeId]);
}
export async function listStuck(db: Db, olderThanMinutes: number): Promise<{ stt_job_id: string }[]> {
  return db.query<{ stt_job_id: string }>("select stt_job_id from recipes where status = 'transcribing' and stt_job_id is not null and updated_at < now() - ($1 || ' minutes')::interval", [String(olderThanMinutes)]);
}
