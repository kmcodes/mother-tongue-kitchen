import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { normalizePhone } from "@/lib/phone";
import { SESSION_COOKIE, signSession } from "@/lib/session";
import { upsertUserByPhone } from "@/lib/users";

export async function POST(request: Request) {
  if (process.env.AUTH_MODE !== "dev" || process.env.VERCEL_ENV === "production") {
    return new NextResponse("Not found", { status: 404 });
  }
  const { phone, name } = (await request.json()) as { phone?: string; name?: string };
  const normalized = normalizePhone(phone ?? "");
  if (!normalized) return NextResponse.json({ error: "Enter a valid Indian mobile number" }, { status: 400 });
  const user = await upsertUserByPhone(getDb(), normalized, name);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, await signSession(user.id), { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 90 });
  return res;
}
