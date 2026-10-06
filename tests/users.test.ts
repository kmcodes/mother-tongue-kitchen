import { describe, it, expect } from "vitest";
import { makeTestDb } from "@/tests/helpers/test-db";
import { upsertUserByPhone } from "@/lib/users";
describe("upsertUserByPhone", () => {
  it("returns the same user for the same phone and keeps the first name", async () => {
    const db = await makeTestDb();
    const a = await upsertUserByPhone(db, "+919876543210", "Asha");
    const b = await upsertUserByPhone(db, "+919876543210", "Other");
    expect(b.id).toBe(a.id);
    expect(b.name).toBe("Asha");
  });
});
