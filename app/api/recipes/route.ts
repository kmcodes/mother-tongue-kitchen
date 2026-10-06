import { NextResponse, after } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth";
import { buildDeps } from "@/lib/deps";
import { startTranscription } from "@/lib/pipeline";
import { createRecipe, listRecipes } from "@/lib/recipes";
import { getDb } from "@/lib/db";

const body = z.object({ audioPathname: z.string().regex(/^recordings\/[A-Za-z0-9._-]+$/), durationSec: z.number().int().min(1).max(7200) });

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const recipe = await createRecipe(getDb(), user.id, parsed.data.audioPathname, parsed.data.durationSec);
  after(() => startTranscription(buildDeps(), recipe.id));
  return NextResponse.json({ recipeId: recipe.id }, { status: 201 });
}

export async function GET() {
  const user = await getSessionUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });
  return NextResponse.json({ recipes: await listRecipes(getDb(), user.id) });
}
