import { SignJWT, jwtVerify } from "jose";
import { requireEnv } from "@/lib/env";
export const SESSION_COOKIE = "mtk_session";
const key = () => new TextEncoder().encode(requireEnv("SESSION_SECRET"));

export async function signSession(userId: string): Promise<string> {
  return new SignJWT({}).setProtectedHeader({ alg: "HS256" }).setSubject(userId).setIssuedAt().setExpirationTime("90d").sign(key());
}
export async function verifySession(token: string): Promise<string | null> {
  try { return (await jwtVerify(token, key())).payload.sub ?? null; } catch { return null; }
}
