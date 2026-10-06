import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { getRecipeForOwner } from "@/lib/recipes";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return new NextResponse("Not found", { status: 404 });
  const recipe = await getRecipeForOwner(getDb(), id, user.id);
  return recipe ? NextResponse.json({ recipe }) : new NextResponse("Not found", { status: 404 });
}
