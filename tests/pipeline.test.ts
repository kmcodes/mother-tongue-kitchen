import { describe, it, expect, vi } from "vitest";
import { makeTestDb } from "@/tests/helpers/test-db";
import { upsertUserByPhone } from "@/lib/users";
import { createRecipe, getRecipeById, getRecipeForOwner, listSegments } from "@/lib/recipes";
import { startTranscription, completeTranscription, retryRecipe, type PipelineDeps } from "@/lib/pipeline";
import type { SttState } from "@/lib/stt/types";

const structured = JSON.stringify({ title: "Aloo Gobi", ingredients: [{ name: "aloo" }], steps: ["kaato"] });
const doneState: SttState = { state: "done", transcript: { language: "hi-IN", text: "aloo kaato", segments: [{ text: "aloo kaato", start: 0, end: 2 }] } };

async function setup(sttFetch: () => Promise<SttState>, llmOut: string | (() => Promise<string>) = structured) {
  const db = await makeTestDb();
  const user = await upsertUserByPhone(db, "+919876543210", "Asha");
  const recipe = await createRecipe(db, user.id, "recordings/x.webm", 90);
  const deps: PipelineDeps = {
    db,
    stt: { start: vi.fn().mockResolvedValue({ jobId: "job-1" }), fetch: vi.fn(sttFetch) },
    llm: { complete: vi.fn(typeof llmOut === "string" ? async () => llmOut : llmOut) },
    readAudio: vi.fn().mockResolvedValue({ bytes: new Uint8Array([1]), filename: "x.webm", contentType: "audio/webm" }),
    callbackUrl: "https://app.test/api/sarvam/webhook",
  };
  return { db, user, recipe, deps };
}

describe("pipeline", () => {
  it("runs uploaded -> transcribing -> ready with segments and a structured recipe", async () => {
    const { db, recipe, deps } = await setup(async () => doneState);
    await startTranscription(deps, recipe.id);
    expect((await getRecipeById(db, recipe.id))?.status).toBe("transcribing");
    expect(await completeTranscription(deps, "job-1")).toBe("ready");
    const r = (await getRecipeById(db, recipe.id))!;
    expect(r.status).toBe("ready");
    expect(r.title).toBe("Aloo Gobi");
    expect(r.language).toBe("hi-IN");
    expect((await listSegments(db, recipe.id)).map((s) => s.text)).toEqual(["aloo kaato"]);
  });

  it("stays pending while the STT job is still running", async () => {
    const { db, recipe, deps } = await setup(async () => ({ state: "pending" }));
    await startTranscription(deps, recipe.id);
    expect(await completeTranscription(deps, "job-1")).toBe("pending");
    expect((await getRecipeById(db, recipe.id))?.status).toBe("transcribing");
  });

  it("marks failed when STT fails, and retry restarts it", async () => {
    let fail = true;
    const { db, user, recipe, deps } = await setup(async () => (fail ? { state: "failed", error: "bad audio" } : doneState));
    await startTranscription(deps, recipe.id);
    expect(await completeTranscription(deps, "job-1")).toBe("failed");
    expect((await getRecipeById(db, recipe.id))?.status).toBe("failed");
    fail = false;
    expect(await retryRecipe(deps, recipe.id, user.id)).toBe(true);
    expect((await getRecipeById(db, recipe.id))?.status).toBe("transcribing");
  });

  it("marks failed when starting the STT job throws", async () => {
    const { db, recipe, deps } = await setup(async () => doneState);
    (deps.stt.start as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("network"));
    await startTranscription(deps, recipe.id);
    const r = (await getRecipeById(db, recipe.id))!;
    expect(r.status).toBe("failed");
    expect(r.error).toMatch(/network/);
  });

  it("[review focus 2] silent audio reaches ready with a note and never calls the LLM", async () => {
    const { db, recipe, deps } = await setup(async () => ({ state: "done", transcript: { language: "unknown", text: "", segments: [] } }));
    await startTranscription(deps, recipe.id);
    expect(await completeTranscription(deps, "job-1")).toBe("ready");
    const r = (await getRecipeById(db, recipe.id))!;
    expect(r.status).toBe("ready");
    expect(r.note).toBe("no_speech");
    expect(deps.llm.complete).not.toHaveBeenCalled();
  });

  it("falls back to the raw transcript when structuring fails", async () => {
    const { db, recipe, deps } = await setup(async () => doneState, "garbage");
    await startTranscription(deps, recipe.id);
    expect(await completeTranscription(deps, "job-1")).toBe("ready");
    const r = (await getRecipeById(db, recipe.id))!;
    expect(r.status).toBe("ready");
    expect(r.title).toBeNull();
    expect(r.transcript_text).toBe("aloo kaato");
    expect(r.note).toBe("structure_failed");
  });

  it("[review focus 3] duplicate completion calls do one transcript and one LLM call", async () => {
    const { db, recipe, deps } = await setup(async () => doneState);
    await startTranscription(deps, recipe.id);
    const results = await Promise.all([completeTranscription(deps, "job-1"), completeTranscription(deps, "job-1")]);
    expect(results.sort()).toEqual(["ignored", "ready"]);
    expect(deps.llm.complete).toHaveBeenCalledTimes(1);
    expect((await listSegments(db, recipe.id)).length).toBe(1);
  });

  it("ignores an unknown job id", async () => {
    const { deps } = await setup(async () => doneState);
    expect(await completeTranscription(deps, "nope")).toBe("ignored");
  });

  it("[review focus 5] another user cannot read a recipe by id", async () => {
    const { db, recipe } = await setup(async () => doneState);
    const other = await upsertUserByPhone(db, "+919123456789", "Ravi");
    expect(await getRecipeForOwner(db, recipe.id, other.id)).toBeNull();
  });
});
