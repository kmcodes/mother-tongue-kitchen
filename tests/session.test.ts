import { describe, it, expect, beforeAll } from "vitest";
import { signSession, verifySession } from "@/lib/session";
beforeAll(() => { process.env.SESSION_SECRET = "test-secret-test-secret-test-secret"; });
describe("session", () => {
  it("round-trips a user id", async () => {
    expect(await verifySession(await signSession("u1"))).toBe("u1");
  });
  it("rejects garbage and tampered tokens", async () => {
    expect(await verifySession("nope")).toBeNull();
    const t = await signSession("u1");
    expect(await verifySession(t.slice(0, -2) + "xx")).toBeNull();
  });
});
