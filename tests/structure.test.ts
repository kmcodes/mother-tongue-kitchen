import { describe, it, expect, vi } from "vitest";
import { structureRecipe, StructureError } from "@/lib/structure";

const good = JSON.stringify({ title: "आलू गोभी", ingredients: [{ name: "आलू", quantity: "2" }, { name: "नमक" }], steps: ["आलू काटो", "तेल गरम करो"] });

describe("structureRecipe", () => {
  it("parses plain JSON and keeps the original language", async () => {
    const llm = { complete: vi.fn().mockResolvedValue(good) };
    const r = await structureRecipe("आलू गोभी बनाने के लिए...", llm);
    expect(r.title).toBe("आलू गोभी");
    expect(r.ingredients[1]).toEqual({ name: "नमक" });
    const [system] = llm.complete.mock.calls[0];
    expect(system).toMatch(/same language/i);
    expect(system).toMatch(/do not translate/i);
  });
  it("accepts JSON wrapped in a code fence", async () => {
    const llm = { complete: vi.fn().mockResolvedValue("```json\n" + good + "\n```") };
    expect((await structureRecipe("x", llm)).steps.length).toBe(2);
  });
  it("[I5] accepts null or empty quantity, which LLMs often emit", async () => {
    const out = JSON.stringify({ title: "T", ingredients: [{ name: "namak", quantity: null }, { name: "tel", quantity: "" }, { name: "jeera", quantity: " 1 tsp " }], steps: ["a"] });
    const r = await structureRecipe("x", { complete: vi.fn().mockResolvedValue(out) });
    expect(r.ingredients).toEqual([{ name: "namak" }, { name: "tel" }, { name: "jeera", quantity: "1 tsp" }]);
  });
  it("retries once on invalid output, then succeeds", async () => {
    const llm = { complete: vi.fn().mockResolvedValueOnce("not json").mockResolvedValueOnce(good) };
    expect((await structureRecipe("x", llm)).title).toBe("आलू गोभी");
    expect(llm.complete).toHaveBeenCalledTimes(2);
  });
  it("throws StructureError after the retry also fails", async () => {
    const llm = { complete: vi.fn().mockResolvedValue("{\"title\": 5}") };
    await expect(structureRecipe("x", llm)).rejects.toBeInstanceOf(StructureError);
    expect(llm.complete).toHaveBeenCalledTimes(2);
  });
});
