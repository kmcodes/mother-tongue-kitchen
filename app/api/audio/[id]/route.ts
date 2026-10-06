import { NextResponse } from "next/server";
import { get } from "@vercel/blob";
import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { getRecipeForOwner } from "@/lib/recipes";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return new NextResponse("Not found", { status: 404 });
  const recipe = await getRecipeForOwner(getDb(), id, user.id);
  if (!recipe) return new NextResponse("Not found", { status: 404 });
  const result = await get(recipe.audio_pathname, { access: "private" });
  if (!result || result.statusCode !== 200) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(result.stream, { headers: { "Content-Type": result.blob.contentType, "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store" } });
}
