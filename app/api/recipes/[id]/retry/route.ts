import { NextResponse, after } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { buildDeps } from "@/lib/deps";
import { getDb } from "@/lib/db";
import { getRecipeForOwner } from "@/lib/recipes";
import { startTranscription } from "@/lib/pipeline";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return new NextResponse("Not found", { status: 404 });
  const recipe = await getRecipeForOwner(getDb(), id, user.id);
  if (!recipe) return new NextResponse("Not found", { status: 404 });
  if (recipe.status !== "failed") return NextResponse.json({ error: "Nothing to retry" }, { status: 409 });
  after(() => startTranscription(buildDeps(), id));
  return NextResponse.json({ ok: true });
}
