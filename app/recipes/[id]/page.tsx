import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { getRecipeForOwner, listSegments } from "@/lib/recipes";
import { RecipeStatus } from "@/components/recipe-status";

export const dynamic = "force-dynamic";

export default async function RecipePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const recipe = await getRecipeForOwner(getDb(), id, user.id);
  if (!recipe) notFound();
  const segments = await listSegments(getDb(), id);
  return (
    <main className="mx-auto max-w-md space-y-6 p-6">
      <Link href="/" className="text-sm underline">Back</Link>
      <div className="flex items-start justify-between gap-3">
        <h1 className="text-2xl font-semibold">{recipe.title ?? "Untitled recipe"}</h1>
        <RecipeStatus id={recipe.id} status={recipe.status} />
      </div>
      <audio controls className="w-full" src={`/api/audio/${recipe.id}`} />
      {recipe.note === "no_speech" && <p className="rounded bg-amber-50 p-3 text-sm">We could not hear any speech in this recording. Please try recording again.</p>}
      {recipe.status === "failed" && <p className="rounded bg-red-50 p-3 text-sm">{recipe.error ?? "Something went wrong."} Tap Retry above.</p>}
      {recipe.ingredients && recipe.ingredients.length > 0 && (
        <section><h2 className="mb-2 font-semibold">Ingredients</h2>
          <ul className="list-disc space-y-1 pl-5">{recipe.ingredients.map((i, n) => <li key={n}>{i.quantity ? `${i.quantity} ` : ""}{i.name}</li>)}</ul></section>
      )}
      {recipe.steps && recipe.steps.length > 0 && (
        <section><h2 className="mb-2 font-semibold">Steps</h2>
          <ol className="list-decimal space-y-2 pl-5">{recipe.steps.map((s, n) => <li key={n}>{s}</li>)}</ol></section>
      )}
      {recipe.note === "structure_failed" && <p className="rounded bg-amber-50 p-3 text-sm">We could not organise this recipe yet. The full transcript is below.</p>}
      {segments.length > 0 && (
        <section><h2 className="mb-2 font-semibold">Transcript</h2>
          <p className="whitespace-pre-wrap leading-relaxed">{segments.map((s) => s.edited_text ?? s.text).join(" ")}</p></section>
      )}
    </main>
  );
}
