import { z } from "zod";
import type { LlmClient } from "@/lib/llm";

export class StructureError extends Error {}

const schema = z.object({
  title: z.string().min(1),
  ingredients: z.array(z.object({ name: z.string().min(1), quantity: z.string().nullish().transform((q) => (q?.trim() ? q.trim() : undefined)) })),
  steps: z.array(z.string().min(1)),
});
export type StructuredRecipe = z.infer<typeof schema>;

const SYSTEM = [
  "You turn a spoken recipe transcript into structured JSON.",
  "Write every field in the same language and script as the transcript. Do not translate.",
  "Use only what the speaker said. Do not invent ingredients, quantities or steps.",
  "Keep spoken quantities as the speaker said them (for example 'ek chammach', 'andaaz se').",
  'Reply with JSON only, shaped as {"title": string, "ingredients": [{"name": string, "quantity"?: string}], "steps": [string]}.',
].join("\n");

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  return JSON.parse((fenced ? fenced[1] : text).trim());
}

export async function structureRecipe(transcriptText: string, llm: LlmClient): Promise<StructuredRecipe> {
  let lastError = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const hint = attempt === 0 ? "" : `\n\nYour previous reply was invalid (${lastError}). Reply with valid JSON only.`;
    try {
      const out = await llm.complete(SYSTEM, `Transcript:\n${transcriptText}${hint}`);
      return schema.parse(extractJson(out));
    } catch (e) {
      lastError = (e as Error).message.slice(0, 200);
    }
  }
  throw new StructureError(lastError);
}
