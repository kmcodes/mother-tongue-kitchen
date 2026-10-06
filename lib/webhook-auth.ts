import { timingSafeEqual } from "node:crypto";
export function verifyWebhookToken(received: string | null, expected: string): boolean {
  if (!received || !expected) return false;
  const a = Buffer.from(received); const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
