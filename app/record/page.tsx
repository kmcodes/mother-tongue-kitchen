import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { Recorder } from "@/components/recorder";
export default async function RecordPage() {
  if (!(await getSessionUser())) redirect("/login");
  return <main className="mx-auto max-w-md"><h1 className="p-6 pb-0 text-2xl font-semibold">Tell us the recipe</h1><Recorder /></main>;
}
