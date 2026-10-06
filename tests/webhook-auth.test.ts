import { describe, it, expect } from "vitest";
import { verifyWebhookToken } from "@/lib/webhook-auth";
describe("verifyWebhookToken", () => {
  it("accepts the exact token only", () => {
    expect(verifyWebhookToken("secret", "secret")).toBe(true);
    expect(verifyWebhookToken("secreT", "secret")).toBe(false);
    expect(verifyWebhookToken("", "secret")).toBe(false);
    expect(verifyWebhookToken(null, "secret")).toBe(false);
    expect(verifyWebhookToken("secret", "")).toBe(false);
  });
});
