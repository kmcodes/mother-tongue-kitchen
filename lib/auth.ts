import { cookies } from "next/headers";
import { getDb } from "@/lib/db";
import { SESSION_COOKIE, verifySession } from "@/lib/session";
import { getUserById, type User } from "@/lib/users";

export async function getSessionUser(): Promise<User | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const id = await verifySession(token);
  return id ? getUserById(getDb(), id) : null;
}
