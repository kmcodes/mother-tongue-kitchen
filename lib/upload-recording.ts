"use client";
import { upload } from "@vercel/blob/client";

function extensionFor(type: string) {
  if (type.includes("mp4")) return "m4a";
  if (type.includes("ogg")) return "ogg";
  return "webm";
}

export async function uploadRecording(blob: Blob, durationSec: number): Promise<{ recipeId: string }> {
  const pathname = `recordings/${crypto.randomUUID()}.${extensionFor(blob.type)}`;
  const stored = await upload(pathname, blob, { access: "private", handleUploadUrl: "/api/recordings/upload", multipart: true });
  const res = await fetch("/api/recipes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ audioPathname: stored.pathname, durationSec }) });
  if (!res.ok) throw new Error("Could not save the recipe");
  return (await res.json()) as { recipeId: string };
}
