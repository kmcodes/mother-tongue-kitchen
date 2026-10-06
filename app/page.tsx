import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { listRecipes } from "@/lib/recipes";
import { RecipeStatus } from "@/components/recipe-status";
import { PendingUploads } from "@/components/pending-uploads";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const recipes = await listRecipes(getDb(), user.id);
  return (
    <main className="mx-auto max-w-md space-y-6 p-6">
      <h1 className="text-2xl font-semibold">Mother Tongue Kitchen</h1>
      <Link href="/record" className="block rounded-xl bg-red-600 p-6 text-center text-xl font-medium text-white shadow">Record a recipe</Link>
      <PendingUploads />
      <ul className="divide-y rounded border">
        {recipes.length === 0 && <li className="p-4 text-sm text-neutral-600">No recipes yet. Record your first one.</li>}
        {recipes.map((r) => (
          <li key={r.id} className="flex items-center justify-between gap-3 p-4">
            <Link href={`/recipes/${r.id}`} className="min-w-0 flex-1">
              <div className="truncate font-medium">{r.title ?? "Untitled recipe"}</div>
              <div className="text-xs text-neutral-500">{new Date(r.created_at).toLocaleDateString("en-IN")} · {Math.round(r.duration_sec / 60) || "<1"} min</div>
            </Link>
            <RecipeStatus id={r.id} status={r.status} />
          </li>
        ))}
      </ul>
    </main>
  );
}
