"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch("/api/auth/dev-login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ phone, name }) });
    if (res.ok) router.push("/");
    else setError((await res.json().catch(() => ({}))).error ?? "Could not sign in");
  }
  return (
    <main className="mx-auto max-w-sm p-6">
      <h1 className="text-2xl font-semibold">Sign in</h1>
      <p className="mt-1 text-sm text-neutral-600">Development login. WhatsApp OTP arrives in Plan 2.</p>
      <form onSubmit={submit} className="mt-6 space-y-4">
        <input className="w-full rounded border p-3" placeholder="Mobile number" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
        <input className="w-full rounded border p-3" placeholder="Your name (first time only)" value={name} onChange={(e) => setName(e.target.value)} />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button className="w-full rounded bg-black p-3 text-white">Continue</button>
      </form>
    </main>
  );
}
