import { describe, it, expect } from "vitest";
describe("tooling", () => {
  it("runs vitest with the @ alias", async () => {
    const { requireEnv } = await import("@/lib/env");
    process.env.__X = "1";
    expect(requireEnv("__X")).toBe("1");
    expect(() => requireEnv("__MISSING")).toThrow(/__MISSING/);
  });
});
