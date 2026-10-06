// Throwaway spike: run the structuring step with several models on saved Sarvam outputs.
// usage: npx tsx scripts/structure-compare.ts --models google/gemini-2.5-flash-lite,anthropic/claude-haiku-4.5 spike-audio/out/*/0.json
import fs from "node:fs";
import path from "node:path";
import { gatewayLlm } from "../lib/llm";
import { structureRecipe } from "../lib/structure";

const args = process.argv.slice(2);
const mi = args.indexOf("--models");
const models = mi >= 0 ? args[mi + 1].split(",") : ["google/gemini-2.5-flash-lite"];
const files = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--models");
if (!files.length) throw new Error("pass one or more Sarvam output .json files");
if (!process.env.AI_GATEWAY_API_KEY) throw new Error("AI_GATEWAY_API_KEY missing (source .env.local first)");

async function main() {
  for (const model of models) {
    process.env.STRUCTURE_MODEL = model;
    for (const f of files) {
      const text: string = JSON.parse(fs.readFileSync(f, "utf8")).transcript ?? "";
      const t0 = Date.now();
      const dir = path.join("spike-audio", "structure", model.replace("/", "_"));
      fs.mkdirSync(dir, { recursive: true });
      const name = f.replace(/[\\/]/g, "_") + ".json";
      try {
        const r = await structureRecipe(text, gatewayLlm());
        fs.writeFileSync(path.join(dir, name), JSON.stringify(r, null, 2));
        console.log(`${model} | ${f} | ${((Date.now() - t0) / 1000).toFixed(1)}s | title="${r.title}" | ${r.ingredients.length} ingredients | ${r.steps.length} steps`);
      } catch (e) {
        console.log(`${model} | ${f} | FAILED: ${(e as Error).message.slice(0, 120)}`);
      }
    }
  }
  console.log("Read the saved JSON in spike-audio/structure/ next to the transcript and score it by hand.");
}
main();
