"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

const label: Record<string, string> = { uploaded: "Saved", transcribing: "Transcribing", structuring: "Writing it up", ready: "Ready", failed: "Needs attention" };

export function RecipeStatus({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const active = status === "uploaded" || status === "transcribing" || status === "structuring";
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => router.refresh(), 4000);
    return () => clearInterval(t);
  }, [active, router]);
  return (
    <span className={`rounded-full px-3 py-1 text-xs ${status === "ready" ? "bg-green-100 text-green-800" : status === "failed" ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-800"}`}>
      {label[status] ?? status}
      {status === "failed" && (
        <button className="ml-2 underline" onClick={async () => { await fetch(`/api/recipes/${id}/retry`, { method: "POST" }); router.refresh(); }}>Retry</button>
      )}
    </span>
  );
}
