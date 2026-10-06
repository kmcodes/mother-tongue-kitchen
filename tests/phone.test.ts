import { describe, it, expect } from "vitest";
import { normalizePhone } from "@/lib/phone";
describe("normalizePhone", () => {
  it.each([
    ["98765 43210", "+919876543210"],
    ["+91 98765-43210", "+919876543210"],
    ["09876543210", "+919876543210"],
    ["919876543210", "+919876543210"],
    ["0091 9876543210", "+919876543210"],
  ])("normalizes %s", (input, out) => expect(normalizePhone(input)).toBe(out));
  it.each(["12345", "", "+14155550123", "5876543210", "abcdefghij"])("rejects %s", (input) =>
    expect(normalizePhone(input)).toBeNull());
});
