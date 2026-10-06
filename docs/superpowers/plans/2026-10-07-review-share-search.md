# Mother Tongue Kitchen: Plan 2, Review, Sign-in, Sharing, Search

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the working record-to-recipe slice into the v1 product: WhatsApp OTP sign-in, sharing by phone number, a review screen where a person taps a transcript segment to hear it and fixes it, search, and the Plan 1 hardening items.

**Architecture:** Same Next.js / Neon / Blob / Sarvam stack as Plan 1. Access control moves from "owner only" to a single `getRecipeAccess` function that every route and page uses. Sharing is keyed on normalised phone number so a recipe can be shared with someone who has not signed up yet. The transcript is stored as segments (sentence or phrase chunks); edits go to `edited_text` and a helper keeps `transcript_text` (used for search) in sync.

**Tech Stack:** unchanged from Plan 1, plus `fix-webm-duration` (client-side WebM duration patch).

**Spec:** `docs/superpowers/specs/2026-10-06-mother-tongue-kitchen-design.md`. **Plan 1:** `docs/superpowers/plans/2026-10-06-record-to-recipe.md` (merged on `master`).

**Prerequisites (owner):** Plan 1 Tasks 0, 1, 3 step 7 and 12 are done: Sarvam key, spike findings in `docs/spike/sarvam-findings.md`, a Neon database, the Meta WhatsApp template **approved**, and a preview deploy that records and transcribes end to end. Task 1 below reads the spike findings and **stops the plan** if tap-to-hear is not feasible.

## Global Constraints

- India only: phone numbers are Indian mobiles, stored as `+91XXXXXXXXXX` (the existing `normalizePhone`).
- Default git branch is `master`; commit with the repo-local noreply identity. Never commit `.env*` (except `.env.example`) or audio.
- Audio stays in a **private** Blob store and is served only through the authenticated `/api/audio/[id]` route.
- The original STT text is never overwritten: edits go in `segments.edited_text`.
- Structured recipe text stays in the **original language**; never translated.
- Recording format is whatever the browser's MediaRecorder produces (WebM/Opus on Chrome, MP4/AAC on Safari). WebM duration metadata is patched before upload so the file is seekable. A fixed 16 kHz WAV recording is the fallback only if the spike shows the patched files do not seek or Sarvam rejects them.
- OTP codes: 6 digits, valid 5 minutes, single use, 5 wrong attempts then locked, at most one request per 30 s and 5 per 15 minutes per phone. Never log a code in production.
- Sign-in responses must not reveal whether a phone number already has an account.
- Screens are English only. UI is normal-sized and uncluttered.
- Secrets only in `.env.local`; `.env.example` lists every key with blank values.

## Review Focus

Inputs the spec implies but no task would otherwise test, most likely first. Each has a test in the task named in brackets.

1. **OTP guessing and reuse:** wrong codes must lock after 5 tries even if the 6th is correct; an expired or already-used code must fail; the code is stored hashed. [Task 4]
2. **Revoked share must lose access everywhere,** including audio, and a former viewer must not be able to re-create the recipe from a remembered audio path. [Tasks 2 and 5]
3. **A view-only person must not edit, retry, restructure or share.** [Tasks 5 and 6]
4. **Search with Indian-script text and wildcard characters:** a Devanagari or Tamil substring must match, and `%` or `_` in the query must be treated literally. Another user's recipes must never appear. [Task 9]
5. **Editing a segment to empty or whitespace, to a huge string, to text in decomposed Unicode, or at an index that does not exist.** [Task 6]

---

## File Structure

```
db/migrations/002_client_id.sql      recipes.client_id for idempotent creates
db/migrations/003_otp.sql            otp_codes
db/migrations/004_shares.sql         shares
lib/ids.ts                           isUuid, recordingPath, isOwnRecordingPath
lib/stt/keyterms.ts                  recipe vocabulary for Sarvam
lib/otp.ts                           generate, request, verify (rate limits, lockout)
lib/whatsapp.ts                      buildOtpPayload, whatsappSender
lib/otp-sender.ts                    getOtpSender (console in dev, WhatsApp otherwise)
lib/session-cookie.ts                attachSession
lib/access.ts                        roles, getRecipeAccess, shares CRUD
lib/segments.ts                      editSegment, syncTranscript, restructureRecipe
lib/review.ts                        activeSegmentIndex, parseByteRange
lib/recorder/fix-duration.ts         WebM duration patch
lib/search.ts                        searchRecipes, likePattern
app/api/auth/request-otp/route.ts, verify-otp/route.ts, name/route.ts
app/api/recipes/[id]/shares/route.ts, segments/[idx]/route.ts, restructure/route.ts
components/share-panel.tsx, transcript-review.tsx
tests/** mirror lib/
```

---

### Task 1: Read the spike findings and wire its decisions

**Files:**
- Create: `lib/stt/keyterms.ts`
- Modify: `lib/stt/sarvam.ts` (send keyterms when enabled), `.env.example`
- Test: `tests/stt/keyterms.test.ts`

**Interfaces:**
- Consumes: `docs/spike/sarvam-findings.md` (owner-supplied).
- Produces: `RECIPE_KEYTERMS: string[]` (at most 50, unique, non-empty); the Sarvam provider sends them when `STT_KEYTERMS=1`.

- [ ] **Step 1: Gate on the findings.** Open `docs/spike/sarvam-findings.md`. **If Q3 says chunks are not usable for tap-to-hear, or Q1 says WebM is rejected, STOP and tell the owner**: Tasks 7 and 8 need a redesign (for example server-side audio conversion or a fixed WAV recorder). Otherwise continue and copy the "Decisions for Plan 2" list into the ledger.

- [ ] **Step 2: Write the failing test**

```ts
// tests/stt/keyterms.test.ts
import { describe, it, expect } from "vitest";
import { RECIPE_KEYTERMS } from "@/lib/stt/keyterms";
describe("RECIPE_KEYTERMS", () => {
  it("fits Sarvam's limit and has no blanks or duplicates", () => {
    expect(RECIPE_KEYTERMS.length).toBeGreaterThan(0);
    expect(RECIPE_KEYTERMS.length).toBeLessThanOrEqual(50);
    expect(RECIPE_KEYTERMS.every((t) => t.trim() === t && t.length > 0)).toBe(true);
    expect(new Set(RECIPE_KEYTERMS.map((t) => t.toLowerCase())).size).toBe(RECIPE_KEYTERMS.length);
  });
});
```

- [ ] **Step 3: Run it to fail** — `npx vitest run tests/stt/keyterms.test.ts` — Expected: FAIL, module not found.

- [ ] **Step 4: Implement.** Replace the starter list with the terms the spike showed Sarvam getting wrong.

```ts
// lib/stt/keyterms.ts
// Bias recognition toward common recipe words (Saaras v4 keyterms, max 50). Edit from spike results.
export const RECIPE_KEYTERMS: string[] = [
  "jeera", "hing", "haldi", "methi", "kasuri methi", "ajwain", "rai", "curry patta", "dhaniya", "garam masala",
  "tadka", "tempering", "ghee", "paneer", "besan", "atta", "maida", "sooji", "poha", "dalia",
  "andaaz", "chammach", "katori", "mutthi", "pinch", "kadhai", "tawa", "pressure cooker", "seeti", "dum",
];
```

Then in `lib/stt/sarvam.ts` add the import `import { RECIPE_KEYTERMS } from "@/lib/stt/keyterms";` and, inside the `createJob({...})` object, add after `withTimestamps: true,`:

```ts
          ...(process.env.STT_KEYTERMS === "1" ? { keyterms: RECIPE_KEYTERMS } : {}),
```

Append to `.env.example`:

```
# Send recipe vocabulary to Sarvam (set to 1 if the spike showed keyterms help)
STT_KEYTERMS=

# WhatsApp Graph API version
WHATSAPP_API_VERSION=v26.0
```

- [ ] **Step 5: Run tests and typecheck** — `npx vitest run && npx tsc --noEmit` — Expected: all PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: recipe keyterms for Sarvam, gated by STT_KEYTERMS"
```

---

### Task 2: Upload ownership, idempotent create, UUID checks

**Files:**
- Create: `lib/ids.ts`, `db/migrations/002_client_id.sql`
- Modify: `lib/recipes.ts` (createRecipe), `lib/recorder/pending.ts` (Uploader gets sessionId), `lib/upload-recording.ts`, `app/api/recordings/upload/route.ts`, `app/api/recipes/route.ts`, `components/recorder.tsx`, `components/pending-uploads.tsx`, `app/record/page.tsx`, `app/page.tsx`
- Test: `tests/ids.test.ts`, `tests/recipes-create.test.ts`, `tests/recorder/pending.test.ts`

**Interfaces:**
- Produces: `isUuid(s: string): boolean`; `recordingPath(userId: string, sessionId: string, ext: string): string`; `isOwnRecordingPath(userId: string, path: string): boolean`; `createRecipe(db, ownerId, audioPathname, durationSec, clientId?: string): Promise<Recipe>` (same `clientId` for the same owner returns the existing recipe); `type Uploader = (blob: Blob, durationSec: number, sessionId: string) => Promise<{ recipeId: string }>`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/ids.test.ts
import { describe, it, expect } from "vitest";
import { isUuid, recordingPath, isOwnRecordingPath } from "@/lib/ids";
const U = "11111111-1111-4111-8111-111111111111";
const V = "22222222-2222-4222-8222-222222222222";
describe("ids", () => {
  it("[M5] isUuid rejects 36 dashes and other lookalikes", () => {
    expect(isUuid(U)).toBe(true);
    expect(isUuid("-".repeat(36))).toBe(false);
    expect(isUuid("")).toBe(false);
    expect(isUuid(U + "x")).toBe(false);
  });
  it("[review focus 2] only the owner's own recordings/<user>/<session>.<ext> path is accepted", () => {
    expect(isOwnRecordingPath(U, recordingPath(U, V, "webm"))).toBe(true);
    expect(isOwnRecordingPath(U, recordingPath(V, V, "webm"))).toBe(false); // someone else's folder
    expect(isOwnRecordingPath(U, `recordings/${U}/../${V}/${V}.webm`)).toBe(false);
    expect(isOwnRecordingPath(U, `recordings/${U}/${V}.exe`)).toBe(false);
    expect(isOwnRecordingPath(U, `recordings/${U}/not-a-uuid.webm`)).toBe(false);
    expect(isOwnRecordingPath("not-a-uuid", "recordings/not-a-uuid/x.webm")).toBe(false);
  });
});
```

```ts
// tests/recipes-create.test.ts
import { describe, it, expect } from "vitest";
import { makeTestDb } from "@/tests/helpers/test-db";
import { upsertUserByPhone } from "@/lib/users";
import { createRecipe } from "@/lib/recipes";
const C = "33333333-3333-4333-8333-333333333333";
describe("createRecipe idempotency", () => {
  it("[M2] the same clientId for the same owner returns the same recipe", async () => {
    const db = await makeTestDb();
    const a = await upsertUserByPhone(db, "+919876543210", "A");
    const r1 = await createRecipe(db, a.id, "recordings/x/1.webm", 60, C);
    const r2 = await createRecipe(db, a.id, "recordings/x/1.webm", 60, C);
    expect(r2.id).toBe(r1.id);
  });
  it("different owners can use the same clientId, and no clientId always creates", async () => {
    const db = await makeTestDb();
    const a = await upsertUserByPhone(db, "+919876543210", "A");
    const b = await upsertUserByPhone(db, "+919123456789", "B");
    expect((await createRecipe(db, a.id, "p", 60, C)).id).not.toBe((await createRecipe(db, b.id, "p", 60, C)).id);
    expect((await createRecipe(db, a.id, "p", 60)).id).not.toBe((await createRecipe(db, a.id, "p", 60)).id);
  });
});
```

In `tests/recorder/pending.test.ts`, extend the "uploads a whole number of seconds" test to also assert the session id is passed: add `expect(up.mock.calls[0][2]).toBe("s");` after the existing assertion.

- [ ] **Step 2: Run to fail** — `npx vitest run tests/ids.test.ts tests/recipes-create.test.ts tests/recorder/pending.test.ts` — Expected: FAIL (module not found; third argument undefined).

- [ ] **Step 3: Implement the id helpers and migration**

```ts
// lib/ids.ts
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s: string) => UUID.test(s);

export function recordingPath(userId: string, sessionId: string, ext: string): string {
  return `recordings/${userId}/${sessionId}.${ext}`;
}
export function isOwnRecordingPath(userId: string, p: string): boolean {
  if (!isUuid(userId)) return false;
  const m = /^recordings\/([^/]+)\/([^/]+)\.(webm|m4a|ogg)$/.exec(p);
  return !!m && m[1] === userId && isUuid(m[2]);
}
```

```sql
-- db/migrations/002_client_id.sql
alter table recipes add column client_id uuid;

create unique index recipes_owner_client_idx on recipes (owner_id, client_id) where client_id is not null;
```

In `lib/recipes.ts` replace `createRecipe` with:

```ts
export async function createRecipe(db: Db, ownerId: string, audioPathname: string, durationSec: number, clientId?: string): Promise<Recipe> {
  const inserted = await db.query<Recipe>(
    `insert into recipes (owner_id, status, audio_pathname, duration_sec, client_id) values ($1, 'uploaded', $2, $3, $4)
     on conflict (owner_id, client_id) where client_id is not null do nothing returning ${COLS}`,
    [ownerId, audioPathname, durationSec, clientId ?? null],
  );
  if (inserted[0]) return inserted[0];
  return (await db.query<Recipe>(`select ${COLS} from recipes where owner_id = $1 and client_id = $2`, [ownerId, clientId]))[0];
}
```

- [ ] **Step 4: Thread the session id and user id through the client**

`lib/recorder/pending.ts`: change the `Uploader` type to `(blob: Blob, durationSec: number, sessionId: string) => Promise<{ recipeId: string }>` and the call to `await upload(blob, Math.max(1, Math.round(durationSec)), sessionId)`.

`lib/upload-recording.ts` (full replacement):

```ts
"use client";
import { upload } from "@vercel/blob/client";
import { recordingPath } from "@/lib/ids";

function extensionFor(type: string) {
  if (type.includes("mp4")) return "m4a";
  if (type.includes("ogg")) return "ogg";
  return "webm";
}

export async function uploadRecording(blob: Blob, durationSec: number, userId: string, sessionId: string): Promise<{ recipeId: string }> {
  const pathname = recordingPath(userId, sessionId, extensionFor(blob.type));
  const stored = await upload(pathname, blob, { access: "private", handleUploadUrl: "/api/recordings/upload", multipart: true });
  const res = await fetch("/api/recipes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ audioPathname: stored.pathname, durationSec, clientId: sessionId }) });
  if (!res.ok) throw new Error("Could not save the recipe");
  return (await res.json()) as { recipeId: string };
}
```

`components/recorder.tsx`: accept `{ userId }: { userId: string }` and change the call to `finishRecording(r.store(), done.sessionId, done.durationSec, (b, d, s) => uploadRecording(b, d, userId, s))`.
`components/pending-uploads.tsx`: accept `{ userId }: { userId: string }` and call `uploadPending(createChunkStore(), (b, d, s) => uploadRecording(b, d, userId, s))`.
`app/record/page.tsx`: `const user = await getSessionUser(); if (!user) redirect("/login");` and render `<Recorder userId={user.id} />`.
`app/page.tsx`: render `<PendingUploads userId={user.id} />`.

- [ ] **Step 5: Bind uploads to the user on the server**

In `app/api/recordings/upload/route.ts` change the token callback:

```ts
      onBeforeGenerateToken: async (pathname) => {
        if (!isOwnRecordingPath(user.id, pathname)) throw new Error("Invalid path");
        return { allowedContentTypes: ["audio/*"], maximumSizeInBytes: 300 * 1024 * 1024, addRandomSuffix: false, allowOverwrite: true };
      },
```

and add `import { isOwnRecordingPath } from "@/lib/ids";`.

In `app/api/recipes/route.ts` replace the `body` schema and the POST create:

```ts
const body = z.object({ audioPathname: z.string(), durationSec: z.number().int().min(1).max(7200), clientId: z.string().uuid() });
```

```ts
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success || !isOwnRecordingPath(user.id, parsed.data.audioPathname)) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const recipe = await createRecipe(getDb(), user.id, parsed.data.audioPathname, parsed.data.durationSec, parsed.data.clientId);
```

(add `import { isOwnRecordingPath } from "@/lib/ids";`).

- [ ] **Step 6: Apply the migration, run tests, typecheck** — `npm run migrate` against Neon (Expected: `applied: 002_client_id.sql`); `npx vitest run && npx tsc --noEmit` — Expected: PASS, no type errors.

- [ ] **Step 7: Commit** — `git add -A && git commit -m "feat: bind uploads to the user and make recipe creation idempotent"`

---

### Task 3: Recorder hygiene and the consent line

**Files:**
- Modify: `lib/recorder/chunk-store.ts`, `lib/recorder/pending.ts`, `lib/recorder/use-recorder.ts`, `components/pending-uploads.tsx`, `app/record/page.tsx`
- Test: `tests/recorder/chunk-store.test.ts`

**Interfaces:**
- Produces: `ChunkStore.listUnfinished(minIdleMs?: number, now?: number): Promise<string[]>` (only sessions whose last write is at least `minIdleMs` old).

- [ ] **Step 1: Write the failing test.** Add to `tests/recorder/chunk-store.test.ts`:

```ts
  it("[M7] listUnfinished can skip sessions that were written to recently", async () => {
    await store.begin("live", "audio/webm");
    await store.append("live", 0, buf(1));
    const now = Date.now();
    expect(await store.listUnfinished(60_000, now)).toEqual([]);
    expect(await store.listUnfinished(60_000, now + 61_000)).toEqual(["live"]);
  });
```

- [ ] **Step 2: Run to fail** — `npx vitest run tests/recorder/chunk-store.test.ts` — Expected: FAIL (first expectation returns `["live"]`).

- [ ] **Step 3: Implement.** In `lib/recorder/chunk-store.ts` change the interface line to `listUnfinished(minIdleMs?: number, now?: number): Promise<string[]>;` and replace `append` and `listUnfinished`:

```ts
    async append(sessionId, seq, data) {
      const tx = (await db).transaction(["sessions", "chunks"], "readwrite");
      await tx.objectStore("chunks").put({ sessionId, seq, data });
      const s = await tx.objectStore("sessions").get(sessionId);
      if (s) await tx.objectStore("sessions").put({ ...s, touchedAt: Date.now() });
      await tx.done;
    },
```

```ts
    async listUnfinished(minIdleMs = 0, now = Date.now()) {
      const all = await (await db).getAll("sessions");
      return all.filter((s) => now - (s.touchedAt ?? s.startedAt) >= minIdleMs).map((s) => s.id as string);
    },
```

In `lib/recorder/pending.ts` change the loop to `for (const id of await store.listUnfinished(30_000)) {`. In `components/pending-uploads.tsx` use `listUnfinished(30_000)` in both places and wrap the click handler body in `try { ... } finally { setBusy(false); }` (move `setBusy(false)` into the `finally`).

- [ ] **Step 4: Unmount cleanup and consent line.** In `lib/recorder/use-recorder.ts` replace the last `useEffect` with:

```ts
  useEffect(() => () => {
    if (tickRef.current) clearInterval(tickRef.current);
    const rec = recRef.current;
    if (rec && rec.state !== "inactive") { try { rec.stop(); } catch {} }
    rec?.stream.getTracks().forEach((t) => t.stop());
    void audioCtxRef.current?.close().catch(() => {});
    void wakeRef.current?.release().catch(() => {});
  }, []);
```

(Leaving the page mid-recording now releases the microphone; the saved chunks appear in the "Upload now" banner.) In `app/record/page.tsx` add under the `<h1>`:

```tsx
<p className="px-6 pt-2 text-sm text-neutral-600">Recording someone else? Tell them first and make sure they are happy to be recorded.</p>
```

- [ ] **Step 5: Run tests and typecheck** — `npx vitest run && npx tsc --noEmit && npm run lint` — Expected: all PASS.

- [ ] **Step 6: Commit** — `git add -A && git commit -m "fix: recorder releases the mic on leave, skips live sessions, consent line"`

---

### Task 4: WhatsApp OTP sign-in

**Files:**
- Create: `db/migrations/003_otp.sql`, `lib/otp.ts`, `lib/whatsapp.ts`, `lib/otp-sender.ts`, `lib/session-cookie.ts`, `app/api/auth/request-otp/route.ts`, `app/api/auth/verify-otp/route.ts`, `app/api/auth/name/route.ts`
- Modify: `lib/users.ts` (setUserName), `app/api/auth/dev-login/route.ts`, `app/login/page.tsx`
- Test: `tests/otp.test.ts`, `tests/whatsapp.test.ts`, `tests/otp-sender.test.ts`, `tests/users.test.ts`

**Interfaces:**
- Produces: `type OtpSender = (phone: string, code: string) => Promise<void>`; `requestOtp(db, send, phone, now?: Date): Promise<{ ok: true } | { ok: false; reason: "too_soon" | "too_many" }>`; `verifyOtp(db, phone, code, now?: Date): Promise<{ ok: true } | { ok: false; reason: "invalid" | "locked" }>`; `buildOtpPayload(phone, code, template)`; `whatsappSender(fetchImpl?)`; `getOtpSender()`; `attachSession(res: NextResponse, userId: string): Promise<void>`; `setUserName(db, id, name): Promise<User>`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/otp.test.ts
import { describe, it, expect, vi, beforeAll } from "vitest";
import { makeTestDb } from "@/tests/helpers/test-db";
import { generateCode, requestOtp, verifyOtp } from "@/lib/otp";
beforeAll(() => { process.env.SESSION_SECRET = "test-secret-test-secret-test-secret"; });
const P = "+919876543210";
const t = (s: number) => new Date(Date.UTC(2026, 9, 7, 10, 0, 0) + s * 1000);

async function issue(db: Awaited<ReturnType<typeof makeTestDb>>, at = 0) {
  let code = "";
  const send = vi.fn(async (_p: string, c: string) => { code = c; });
  const r = await requestOtp(db, send, P, t(at));
  return { r, send, code: () => code };
}

describe("otp", () => {
  it("generates 6-digit codes", () => {
    for (let i = 0; i < 50; i++) expect(generateCode()).toMatch(/^\d{6}$/);
  });
  it("sends a code, stores it hashed, and verifies it once", async () => {
    const db = await makeTestDb();
    const { r, code } = await issue(db);
    expect(r).toEqual({ ok: true });
    const stored = await db.query<{ code_hash: string }>("select code_hash from otp_codes");
    expect(stored[0].code_hash).not.toContain(code());
    expect(await verifyOtp(db, P, code(), t(10))).toEqual({ ok: true });
    expect(await verifyOtp(db, P, code(), t(11))).toEqual({ ok: false, reason: "invalid" }); // single use
  });
  it("[review focus 1] locks after 5 wrong tries even if the next code is right", async () => {
    const db = await makeTestDb();
    const { code } = await issue(db);
    const wrong = code() === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i++) expect(await verifyOtp(db, P, wrong, t(10 + i))).toEqual({ ok: false, reason: "invalid" });
    expect(await verifyOtp(db, P, code(), t(20))).toEqual({ ok: false, reason: "locked" });
  });
  it("[review focus 1] rejects an expired code", async () => {
    const db = await makeTestDb();
    const { code } = await issue(db);
    expect(await verifyOtp(db, P, code(), t(5 * 60 + 1))).toEqual({ ok: false, reason: "invalid" });
  });
  it("limits requests: one per 30 s, five per 15 minutes", async () => {
    const db = await makeTestDb();
    expect((await issue(db, 0)).r).toEqual({ ok: true });
    expect((await issue(db, 10)).r).toEqual({ ok: false, reason: "too_soon" });
    for (const s of [40, 80, 120, 160]) expect((await issue(db, s)).r).toEqual({ ok: true });
    expect((await issue(db, 200)).r).toEqual({ ok: false, reason: "too_many" });
    expect((await issue(db, 15 * 60 + 1)).r).toEqual({ ok: true });
  });
  it("a failed send does not use up the rate limit and leaves no code behind", async () => {
    const db = await makeTestDb();
    const send = vi.fn().mockRejectedValue(new Error("whatsapp down"));
    await expect(requestOtp(db, send, P, t(0))).rejects.toThrow("whatsapp down");
    expect(await db.query("select 1 from otp_codes")).toEqual([]);
    expect((await issue(db, 1)).r).toEqual({ ok: true });
  });
  it("a newer code replaces the older one", async () => {
    const db = await makeTestDb();
    const first = await issue(db, 0);
    const old = first.code();
    const second = await issue(db, 40);
    if (old !== second.code()) expect(await verifyOtp(db, P, old, t(50))).toEqual({ ok: false, reason: "invalid" });
    expect(await verifyOtp(db, P, second.code(), t(51))).toEqual({ ok: true });
  });
});
```

```ts
// tests/whatsapp.test.ts
import { describe, it, expect, vi, beforeAll } from "vitest";
import { buildOtpPayload, whatsappSender } from "@/lib/whatsapp";
beforeAll(() => {
  process.env.WHATSAPP_ACCESS_TOKEN = "tok";
  process.env.WHATSAPP_PHONE_NUMBER_ID = "123";
  process.env.WHATSAPP_OTP_TEMPLATE_NAME = "mtk_login_code";
  process.env.WHATSAPP_API_VERSION = "v26.0";
});
describe("whatsapp", () => {
  it("builds the authentication-template payload with the code in body and button", () => {
    expect(buildOtpPayload("+919876543210", "123456", "mtk_login_code")).toEqual({
      messaging_product: "whatsapp", recipient_type: "individual", to: "919876543210", type: "template",
      template: { name: "mtk_login_code", language: { code: "en_US" }, components: [
        { type: "body", parameters: [{ type: "text", text: "123456" }] },
        { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: "123456" }] },
      ] },
    });
  });
  it("posts to the Graph API with a bearer token", async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, text: async () => "" });
    await whatsappSender(f as never)("+919876543210", "123456");
    const [url, init] = f.mock.calls[0];
    expect(url).toBe("https://graph.facebook.com/v26.0/123/messages");
    expect(init.headers.authorization).toBe("Bearer tok");
    expect(JSON.parse(init.body).template.name).toBe("mtk_login_code");
  });
  it("throws on a failed send without echoing the code", async () => {
    const f = vi.fn().mockResolvedValue({ ok: false, status: 400, text: async () => "bad template" });
    await expect(whatsappSender(f as never)("+919876543210", "123456")).rejects.toThrow(/400/);
    await whatsappSender(f as never)("+919876543210", "123456").catch((e: Error) => expect(e.message).not.toContain("123456"));
  });
});
```

```ts
// tests/otp-sender.test.ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { getOtpSender } from "@/lib/otp-sender";
afterEach(() => { delete process.env.AUTH_MODE; delete process.env.VERCEL_ENV; delete process.env.WHATSAPP_ACCESS_TOKEN; vi.restoreAllMocks(); });
describe("getOtpSender", () => {
  it("logs the code to the console in local dev mode", async () => {
    process.env.AUTH_MODE = "dev";
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await getOtpSender()("+919876543210", "654321");
    expect(log).toHaveBeenCalledWith(expect.stringContaining("654321"));
  });
  it("[security] never logs codes in production even if AUTH_MODE=dev is set", async () => {
    process.env.AUTH_MODE = "dev";
    process.env.VERCEL_ENV = "production";
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await expect(getOtpSender()("+919876543210", "654321")).rejects.toThrow(/WHATSAPP/);
    expect(log).not.toHaveBeenCalled();
  });
});
```

Add to `tests/users.test.ts`:

```ts
import { setUserName } from "@/lib/users";
describe("setUserName", () => {
  it("sets the name", async () => {
    const db = await makeTestDb();
    const u = await upsertUserByPhone(db, "+919876543210");
    expect((await setUserName(db, u.id, "Asha")).name).toBe("Asha");
  });
});
```

- [ ] **Step 2: Run to fail** — `npx vitest run tests/otp.test.ts tests/whatsapp.test.ts tests/otp-sender.test.ts tests/users.test.ts` — Expected: FAIL (modules not found).

- [ ] **Step 3: Migration and OTP logic**

```sql
-- db/migrations/003_otp.sql
create table otp_codes (
  id uuid primary key default gen_random_uuid(),
  phone text not null,
  code_hash text not null,
  expires_at timestamptz not null,
  attempts integer not null default 0,
  consumed_at timestamptz,
  created_at timestamptz not null
);

create index otp_codes_phone_idx on otp_codes (phone, created_at desc);
```

```ts
// lib/otp.ts
import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import type { Db } from "@/lib/db";
import { requireEnv } from "@/lib/env";

export type OtpSender = (phone: string, code: string) => Promise<void>;
const TTL_MS = 5 * 60_000;
const MIN_GAP_MS = 30_000;
const WINDOW_MS = 15 * 60_000;
const MAX_PER_WINDOW = 5;
const MAX_ATTEMPTS = 5;

export const generateCode = () => String(randomInt(0, 1_000_000)).padStart(6, "0");
const hash = (phone: string, code: string) => createHmac("sha256", requireEnv("SESSION_SECRET")).update(`${phone}:${code}`).digest("hex");
const iso = (d: Date) => d.toISOString();

export async function requestOtp(db: Db, send: OtpSender, phone: string, now = new Date()): Promise<{ ok: true } | { ok: false; reason: "too_soon" | "too_many" }> {
  const recent = await db.query<{ created_at: string }>("select created_at from otp_codes where phone = $1 and created_at > $2 order by created_at desc", [phone, iso(new Date(now.getTime() - WINDOW_MS))]);
  if (recent[0] && now.getTime() - new Date(recent[0].created_at).getTime() < MIN_GAP_MS) return { ok: false, reason: "too_soon" };
  if (recent.length >= MAX_PER_WINDOW) return { ok: false, reason: "too_many" };
  const code = generateCode();
  const row = await db.query<{ id: string }>(
    "insert into otp_codes (phone, code_hash, expires_at, created_at) values ($1, $2, $3, $4) returning id",
    [phone, hash(phone, code), iso(new Date(now.getTime() + TTL_MS)), iso(now)],
  );
  try {
    await send(phone, code);
  } catch (e) {
    await db.query("delete from otp_codes where id = $1", [row[0].id]);
    throw e;
  }
  return { ok: true };
}

export async function verifyOtp(db: Db, phone: string, code: string, now = new Date()): Promise<{ ok: true } | { ok: false; reason: "invalid" | "locked" }> {
  const rows = await db.query<{ id: string; code_hash: string; attempts: number }>(
    "select id, code_hash, attempts from otp_codes where phone = $1 and consumed_at is null and expires_at > $2 order by created_at desc limit 1",
    [phone, iso(now)],
  );
  const row = rows[0];
  if (!row) return { ok: false, reason: "invalid" };
  if (row.attempts >= MAX_ATTEMPTS) return { ok: false, reason: "locked" };
  await db.query("update otp_codes set attempts = attempts + 1 where id = $1", [row.id]);
  const a = Buffer.from(hash(phone, code));
  const b = Buffer.from(row.code_hash);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, reason: "invalid" };
  const used = await db.query("update otp_codes set consumed_at = $2 where id = $1 and consumed_at is null returning id", [row.id, iso(now)]);
  return used.length ? { ok: true } : { ok: false, reason: "invalid" };
}
```

- [ ] **Step 4: WhatsApp sender and sender selection**

```ts
// lib/whatsapp.ts
import { requireEnv } from "@/lib/env";
import type { OtpSender } from "@/lib/otp";

export function buildOtpPayload(phone: string, code: string, template: string) {
  return {
    messaging_product: "whatsapp", recipient_type: "individual", to: phone.replace(/^\+/, ""), type: "template",
    template: { name: template, language: { code: "en_US" }, components: [
      { type: "body", parameters: [{ type: "text", text: code }] },
      { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: code }] },
    ] },
  };
}

export function whatsappSender(fetchImpl: typeof fetch = fetch): OtpSender {
  return async (phone, code) => {
    const version = process.env.WHATSAPP_API_VERSION || "v26.0";
    const res = await fetchImpl(`https://graph.facebook.com/${version}/${requireEnv("WHATSAPP_PHONE_NUMBER_ID")}/messages`, {
      method: "POST",
      headers: { authorization: `Bearer ${requireEnv("WHATSAPP_ACCESS_TOKEN")}`, "content-type": "application/json" },
      body: JSON.stringify(buildOtpPayload(phone, code, requireEnv("WHATSAPP_OTP_TEMPLATE_NAME"))),
    });
    if (!res.ok) throw new Error(`WhatsApp send failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  };
}
```

```ts
// lib/otp-sender.ts
import type { OtpSender } from "@/lib/otp";
import { whatsappSender } from "@/lib/whatsapp";

export function getOtpSender(): OtpSender {
  if (process.env.AUTH_MODE === "dev" && process.env.VERCEL_ENV !== "production") {
    return async (phone, code) => { console.log(`[dev otp] ${phone}: ${code}`); };
  }
  return whatsappSender();
}
```

- [ ] **Step 5: Session cookie helper, user name, routes**

```ts
// lib/session-cookie.ts
import type { NextResponse } from "next/server";
import { SESSION_COOKIE, signSession } from "@/lib/session";

export async function attachSession(res: NextResponse, userId: string): Promise<void> {
  res.cookies.set(SESSION_COOKIE, await signSession(userId), { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 90 });
}
```

Append to `lib/users.ts`:

```ts
export async function setUserName(db: Db, id: string, name: string): Promise<User> {
  return (await db.query<User>("update users set name = $2 where id = $1 returning id, phone, name", [id, name]))[0];
}
```

Replace `app/api/auth/dev-login/route.ts` with:

```ts
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { normalizePhone } from "@/lib/phone";
import { attachSession } from "@/lib/session-cookie";
import { upsertUserByPhone } from "@/lib/users";

export async function POST(request: Request) {
  if (process.env.AUTH_MODE !== "dev" || process.env.VERCEL_ENV === "production") {
    return new NextResponse("Not found", { status: 404 });
  }
  const body = (await request.json().catch(() => null)) as { phone?: string; name?: string } | null;
  const normalized = normalizePhone(body?.phone ?? "");
  if (!normalized) return NextResponse.json({ error: "Enter a valid Indian mobile number" }, { status: 400 });
  const user = await upsertUserByPhone(getDb(), normalized, body?.name);
  const res = NextResponse.json({ ok: true });
  await attachSession(res, user.id);
  return res;
}
```

```ts
// app/api/auth/request-otp/route.ts
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requestOtp } from "@/lib/otp";
import { getOtpSender } from "@/lib/otp-sender";
import { normalizePhone } from "@/lib/phone";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { phone?: string } | null;
  const phone = normalizePhone(body?.phone ?? "");
  if (!phone) return NextResponse.json({ error: "Enter a valid Indian mobile number" }, { status: 400 });
  try {
    const r = await requestOtp(getDb(), getOtpSender(), phone);
    if (!r.ok) return NextResponse.json({ error: r.reason === "too_soon" ? "Please wait a moment before asking for another code." : "Too many codes requested. Try again later." }, { status: 429 });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Could not send the code. Please try again." }, { status: 502 });
  }
}
```

```ts
// app/api/auth/verify-otp/route.ts
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { verifyOtp } from "@/lib/otp";
import { normalizePhone } from "@/lib/phone";
import { attachSession } from "@/lib/session-cookie";
import { upsertUserByPhone } from "@/lib/users";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { phone?: string; code?: string } | null;
  const phone = normalizePhone(body?.phone ?? "");
  if (!phone || !/^\d{6}$/.test(body?.code ?? "")) return NextResponse.json({ error: "Enter the 6-digit code" }, { status: 400 });
  const r = await verifyOtp(getDb(), phone, body!.code!);
  if (!r.ok) {
    return r.reason === "locked"
      ? NextResponse.json({ error: "Too many wrong tries. Ask for a new code." }, { status: 429 })
      : NextResponse.json({ error: "That code is not right or has expired." }, { status: 401 });
  }
  const user = await upsertUserByPhone(getDb(), phone);
  const res = NextResponse.json({ ok: true, needsName: !user.name });
  await attachSession(res, user.id);
  return res;
}
```

```ts
// app/api/auth/name/route.ts
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { setUserName } from "@/lib/users";

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });
  const body = (await request.json().catch(() => null)) as { name?: string } | null;
  const name = (body?.name ?? "").normalize("NFC").trim();
  if (name.length < 1 || name.length > 60) return NextResponse.json({ error: "Enter your name" }, { status: 400 });
  await setUserName(getDb(), user.id, name);
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 6: Login page (three steps).** Replace `app/login/page.tsx`:

```tsx
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

async function post(url: string, body: unknown) {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { ok: res.ok, data: (await res.json().catch(() => ({}))) as { error?: string; needsName?: boolean } };
}

export default function LoginPage() {
  const router = useRouter();
  const [step, setStep] = useState<"phone" | "code" | "name">("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<void>) { setBusy(true); setError(""); try { await fn(); } finally { setBusy(false); } }

  return (
    <main className="mx-auto max-w-sm space-y-4 p-6">
      <h1 className="text-2xl font-semibold">Sign in</h1>
      {step === "phone" && (
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); run(async () => { const r = await post("/api/auth/request-otp", { phone }); if (r.ok) setStep("code"); else setError(r.data.error ?? "Something went wrong"); }); }}>
          <p className="text-sm text-neutral-600">We will send a code on WhatsApp.</p>
          <input className="w-full rounded border p-3" placeholder="Mobile number" inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
          <button disabled={busy} className="w-full rounded bg-black p-3 text-white">Send code</button>
        </form>
      )}
      {step === "code" && (
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); run(async () => { const r = await post("/api/auth/verify-otp", { phone, code }); if (!r.ok) setError(r.data.error ?? "Something went wrong"); else if (r.data.needsName) setStep("name"); else router.push("/"); }); }}>
          <p className="text-sm text-neutral-600">Enter the 6-digit code we sent to {phone} on WhatsApp.</p>
          <input className="w-full rounded border p-3 text-center text-2xl tracking-widest" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />
          <button disabled={busy || code.length !== 6} className="w-full rounded bg-black p-3 text-white">Continue</button>
          <button type="button" className="text-sm underline" onClick={() => { setCode(""); setStep("phone"); }}>Use a different number</button>
        </form>
      )}
      {step === "name" && (
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); run(async () => { const r = await post("/api/auth/name", { name }); if (r.ok) router.push("/"); else setError(r.data.error ?? "Something went wrong"); }); }}>
          <p className="text-sm text-neutral-600">What should we call you?</p>
          <input className="w-full rounded border p-3" placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} />
          <button disabled={busy} className="w-full rounded bg-black p-3 text-white">Done</button>
        </form>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </main>
  );
}
```

- [ ] **Step 7: Apply the migration, run tests, typecheck, lint** — `npm run migrate` (Expected: `applied: 003_otp.sql`); `npx vitest run && npx tsc --noEmit && npm run lint` — Expected: all PASS. With `AUTH_MODE=dev` locally the code appears in the dev-server console.

- [ ] **Step 8: Commit** — `git add -A && git commit -m "feat: WhatsApp OTP sign-in with rate limits and lockout"`

---

### Task 5: Sharing and access control

**Files:**
- Create: `db/migrations/004_shares.sql`, `lib/access.ts`, `app/api/recipes/[id]/shares/route.ts`, `components/share-panel.tsx`
- Modify: `app/api/recipes/[id]/route.ts`, `app/api/recipes/[id]/retry/route.ts`, `app/api/audio/[id]/route.ts`, `app/recipes/[id]/page.tsx`, `app/page.tsx`
- Test: `tests/access.test.ts`

**Interfaces:**
- Consumes: `isUuid` (Task 2), `normalizePhone`, `Recipe`, `getRecipeById`.
- Produces: `type Role = "owner" | "edit" | "view"`; `getRecipeAccess(db, recipeId: string, user: { id: string; phone: string }): Promise<{ recipe: Recipe; role: Role } | null>`; `canEdit(role: Role): boolean`; `addShare(db, recipe: Recipe, owner: { id: string; phone: string }, rawPhone: string, role: "view" | "edit"): Promise<{ ok: true } | { ok: false; reason: "invalid_phone" | "self" }>`; `removeShare(db, recipeId: string, phone: string): Promise<void>`; `listShares(db, recipeId: string): Promise<{ phone: string; role: "view" | "edit" }[]>`; `listSharedWithMe(db, user: { phone: string }): Promise<Recipe[]>`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/access.test.ts
import { describe, it, expect } from "vitest";
import { makeTestDb } from "@/tests/helpers/test-db";
import { upsertUserByPhone } from "@/lib/users";
import { createRecipe } from "@/lib/recipes";
import { addShare, canEdit, getRecipeAccess, listShares, listSharedWithMe, removeShare } from "@/lib/access";

async function setup() {
  const db = await makeTestDb();
  const owner = await upsertUserByPhone(db, "+919876543210", "Owner");
  const friend = await upsertUserByPhone(db, "+919123456789", "Friend");
  const stranger = await upsertUserByPhone(db, "+919000000001", "Stranger");
  const recipe = await createRecipe(db, owner.id, "recordings/x.webm", 60);
  return { db, owner, friend, stranger, recipe };
}

describe("access", () => {
  it("owner has owner access; a stranger has none", async () => {
    const { db, owner, stranger, recipe } = await setup();
    expect((await getRecipeAccess(db, recipe.id, owner))?.role).toBe("owner");
    expect(await getRecipeAccess(db, recipe.id, stranger)).toBeNull();
  });
  it("a shared person gets exactly the role granted; only owner and edit can edit", async () => {
    const { db, owner, friend, recipe } = await setup();
    await addShare(db, recipe, owner, "091234 56789", "view");
    expect((await getRecipeAccess(db, recipe.id, friend))?.role).toBe("view");
    expect(canEdit("view")).toBe(false);
    await addShare(db, recipe, owner, "+91 91234-56789", "edit");
    expect((await getRecipeAccess(db, recipe.id, friend))?.role).toBe("edit");
    expect(canEdit("edit")).toBe(true);
    expect(canEdit("owner")).toBe(true);
  });
  it("[review focus 2] revoking a share removes access", async () => {
    const { db, owner, friend, recipe } = await setup();
    await addShare(db, recipe, owner, "9123456789", "view");
    await removeShare(db, recipe.id, "+919123456789");
    expect(await getRecipeAccess(db, recipe.id, friend)).toBeNull();
    expect(await listSharedWithMe(db, friend)).toEqual([]);
  });
  it("sharing with a number that has no account yet works once they sign up", async () => {
    const { db, owner, recipe } = await setup();
    await addShare(db, recipe, owner, "9111111111", "view");
    const late = await upsertUserByPhone(db, "+919111111111", "Late");
    expect((await getRecipeAccess(db, recipe.id, late))?.role).toBe("view");
    expect((await listSharedWithMe(db, late)).map((r) => r.id)).toEqual([recipe.id]);
  });
  it("rejects invalid numbers and sharing with yourself", async () => {
    const { db, owner, recipe } = await setup();
    expect(await addShare(db, recipe, owner, "12345", "view")).toEqual({ ok: false, reason: "invalid_phone" });
    expect(await addShare(db, recipe, owner, "9876543210", "view")).toEqual({ ok: false, reason: "self" });
  });
  it("lists shares for the owner's panel", async () => {
    const { db, owner, recipe } = await setup();
    await addShare(db, recipe, owner, "9123456789", "edit");
    expect(await listShares(db, recipe.id)).toEqual([{ phone: "+919123456789", role: "edit" }]);
  });
  it("returns null for an unknown recipe id", async () => {
    const { db, owner } = await setup();
    expect(await getRecipeAccess(db, "99999999-9999-4999-8999-999999999999", owner)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to fail** — `npx vitest run tests/access.test.ts` — Expected: FAIL, module not found.

- [ ] **Step 3: Migration and access module**

```sql
-- db/migrations/004_shares.sql
create table shares (
  recipe_id uuid not null references recipes(id) on delete cascade,
  phone text not null,
  role text not null check (role in ('view','edit')),
  created_at timestamptz not null default now(),
  primary key (recipe_id, phone)
);

create index shares_phone_idx on shares (phone);
```

```ts
// lib/access.ts
import type { Db } from "@/lib/db";
import { normalizePhone } from "@/lib/phone";
import { getRecipeById, type Recipe } from "@/lib/recipes";

export type Role = "owner" | "edit" | "view";
type Who = { id: string; phone: string };

export const canEdit = (role: Role) => role === "owner" || role === "edit";

export async function getRecipeAccess(db: Db, recipeId: string, user: Who): Promise<{ recipe: Recipe; role: Role } | null> {
  const recipe = await getRecipeById(db, recipeId);
  if (!recipe) return null;
  if (recipe.owner_id === user.id) return { recipe, role: "owner" };
  const share = (await db.query<{ role: "view" | "edit" }>("select role from shares where recipe_id = $1 and phone = $2", [recipeId, user.phone]))[0];
  return share ? { recipe, role: share.role } : null;
}

export async function addShare(db: Db, recipe: Recipe, owner: Who, rawPhone: string, role: "view" | "edit"): Promise<{ ok: true } | { ok: false; reason: "invalid_phone" | "self" }> {
  const phone = normalizePhone(rawPhone);
  if (!phone) return { ok: false, reason: "invalid_phone" };
  if (phone === owner.phone) return { ok: false, reason: "self" };
  await db.query("insert into shares (recipe_id, phone, role) values ($1, $2, $3) on conflict (recipe_id, phone) do update set role = excluded.role", [recipe.id, phone, role]);
  return { ok: true };
}

export async function removeShare(db: Db, recipeId: string, phone: string): Promise<void> {
  await db.query("delete from shares where recipe_id = $1 and phone = $2", [recipeId, phone]);
}

export async function listShares(db: Db, recipeId: string): Promise<{ phone: string; role: "view" | "edit" }[]> {
  return db.query("select phone, role from shares where recipe_id = $1 order by created_at", [recipeId]);
}

export async function listSharedWithMe(db: Db, user: { phone: string }): Promise<Recipe[]> {
  return db.query<Recipe>(
    `select r.id, r.owner_id, r.title, r.status, r.note, r.error, r.language, r.audio_pathname, r.duration_sec, r.stt_job_id, r.transcript_text, r.ingredients, r.steps, r.created_at
     from recipes r join shares s on s.recipe_id = r.id where s.phone = $1 order by r.created_at desc limit 200`,
    [user.phone],
  );
}
```

- [ ] **Step 4: Switch every route and page to `getRecipeAccess`.** Replace these files in full.

```ts
// app/api/recipes/[id]/route.ts
import { NextResponse } from "next/server";
import { getRecipeAccess } from "@/lib/access";
import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { isUuid } from "@/lib/ids";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });
  const { id } = await ctx.params;
  if (!isUuid(id)) return new NextResponse("Not found", { status: 404 });
  const access = await getRecipeAccess(getDb(), id, user);
  return access ? NextResponse.json({ recipe: access.recipe, role: access.role }) : new NextResponse("Not found", { status: 404 });
}
```

```ts
// app/api/recipes/[id]/retry/route.ts
import { NextResponse, after } from "next/server";
import { canEdit, getRecipeAccess } from "@/lib/access";
import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { buildDeps } from "@/lib/deps";
import { isUuid } from "@/lib/ids";
import { startTranscription } from "@/lib/pipeline";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });
  const { id } = await ctx.params;
  if (!isUuid(id)) return new NextResponse("Not found", { status: 404 });
  const access = await getRecipeAccess(getDb(), id, user);
  if (!access) return new NextResponse("Not found", { status: 404 });
  if (!canEdit(access.role)) return new NextResponse("Forbidden", { status: 403 });
  if (access.recipe.status !== "failed") return NextResponse.json({ error: "Nothing to retry" }, { status: 409 });
  after(() => startTranscription(buildDeps(), id));
  return NextResponse.json({ ok: true });
}
```

For `app/api/audio/[id]/route.ts` keep the current body but replace the imports and the two lookup lines: import `getRecipeAccess` from `@/lib/access` and `isUuid` from `@/lib/ids`, use `if (!isUuid(id))`, then `const access = await getRecipeAccess(getDb(), id, user); if (!access) return new NextResponse("Not found", { status: 404 });` and read `access.recipe.audio_pathname`. (Range support is added in Task 7.)

```ts
// app/api/recipes/[id]/shares/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { addShare, getRecipeAccess, listShares, removeShare } from "@/lib/access";
import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { isUuid } from "@/lib/ids";
import { normalizePhone } from "@/lib/phone";

async function ownerAccess(id: string) {
  const user = await getSessionUser();
  if (!user) return { error: new NextResponse("Unauthorized", { status: 401 }) } as const;
  if (!isUuid(id)) return { error: new NextResponse("Not found", { status: 404 }) } as const;
  const access = await getRecipeAccess(getDb(), id, user);
  if (!access) return { error: new NextResponse("Not found", { status: 404 }) } as const;
  if (access.role !== "owner") return { error: new NextResponse("Forbidden", { status: 403 }) } as const;
  return { user, recipe: access.recipe } as const;
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const a = await ownerAccess((await ctx.params).id);
  if ("error" in a) return a.error;
  return NextResponse.json({ shares: await listShares(getDb(), a.recipe.id) });
}

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const a = await ownerAccess((await ctx.params).id);
  if ("error" in a) return a.error;
  const parsed = z.object({ phone: z.string(), role: z.enum(["view", "edit"]) }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const r = await addShare(getDb(), a.recipe, a.user, parsed.data.phone, parsed.data.role);
  if (!r.ok) return NextResponse.json({ error: r.reason === "self" ? "That is your own number." : "Enter a valid Indian mobile number." }, { status: 400 });
  return NextResponse.json({ shares: await listShares(getDb(), a.recipe.id) });
}

export async function DELETE(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const a = await ownerAccess((await ctx.params).id);
  if ("error" in a) return a.error;
  const phone = normalizePhone(new URL(request.url).searchParams.get("phone") ?? "");
  if (!phone) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  await removeShare(getDb(), a.recipe.id, phone);
  return NextResponse.json({ shares: await listShares(getDb(), a.recipe.id) });
}
```

```tsx
// components/share-panel.tsx
"use client";
import { useEffect, useState } from "react";

type Share = { phone: string; role: "view" | "edit" };

export function SharePanel({ recipeId }: { recipeId: string }) {
  const [shares, setShares] = useState<Share[]>([]);
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState<"view" | "edit">("view");
  const [error, setError] = useState("");
  const base = `/api/recipes/${recipeId}/shares`;

  useEffect(() => { fetch(base).then((r) => r.json()).then((d) => setShares(d.shares ?? [])).catch(() => {}); }, [base]);

  async function add(e: React.FormEvent) {
    e.preventDefault(); setError("");
    const res = await fetch(base, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ phone, role }) });
    const d = await res.json();
    if (res.ok) { setShares(d.shares); setPhone(""); } else setError(d.error ?? "Could not share");
  }
  async function remove(p: string) {
    const res = await fetch(`${base}?phone=${encodeURIComponent(p)}`, { method: "DELETE" });
    if (res.ok) setShares((await res.json()).shares);
  }

  return (
    <section className="space-y-3 rounded border p-4">
      <h2 className="font-semibold">Share this recipe</h2>
      <form onSubmit={add} className="flex flex-wrap gap-2">
        <input className="min-w-0 flex-1 rounded border p-2" placeholder="Mobile number" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
        <select className="rounded border p-2" value={role} onChange={(e) => setRole(e.target.value as "view" | "edit")}>
          <option value="view">Can view</option><option value="edit">Can edit</option>
        </select>
        <button className="rounded bg-black px-4 py-2 text-white">Share</button>
      </form>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <ul className="space-y-1 text-sm">
        {shares.map((s) => (
          <li key={s.phone} className="flex items-center justify-between"><span>{s.phone} · {s.role === "edit" ? "can edit" : "can view"}</span>
            <button className="underline" onClick={() => remove(s.phone)}>Remove</button></li>
        ))}
      </ul>
    </section>
  );
}
```

Update `app/recipes/[id]/page.tsx`: import `getRecipeAccess` and `canEdit` from `@/lib/access` and `isUuid` from `@/lib/ids`, use `if (!isUuid(id)) notFound();`, `const access = await getRecipeAccess(getDb(), id, user); if (!access) notFound(); const { recipe, role } = access;`, and render `{role === "owner" && <SharePanel recipeId={recipe.id} />}` at the bottom (import `SharePanel`). Pass `canEdit(role)` to the review component in Task 8; until then nothing else changes. In `app/page.tsx` add below the recipe list:

```tsx
      {shared.length > 0 && (
        <section><h2 className="mb-2 font-semibold">Shared with you</h2>
          <ul className="divide-y rounded border">{shared.map((r) => (
            <li key={r.id} className="p-4"><Link href={`/recipes/${r.id}`} className="block"><div className="truncate font-medium">{r.title ?? "Untitled recipe"}</div></Link></li>
          ))}</ul></section>
      )}
```

with `const shared = await listSharedWithMe(getDb(), user);` (import from `@/lib/access`).

- [ ] **Step 5: Apply the migration, run tests, typecheck, lint** — `npm run migrate` (Expected: `applied: 004_shares.sql`); `npx vitest run && npx tsc --noEmit && npm run lint` — Expected: all PASS.

- [ ] **Step 6: Commit** — `git add -A && git commit -m "feat: sharing by phone number with view and edit roles"`

---

### Task 6: Segment editing and recipe update (backend)

**Files:**
- Create: `lib/segments.ts`, `app/api/recipes/[id]/segments/[idx]/route.ts`, `app/api/recipes/[id]/restructure/route.ts`
- Modify: `lib/stt/sarvam.ts` (NFC), `lib/structure.ts` (NFC title)
- Test: `tests/segments.test.ts`

**Interfaces:**
- Consumes: `canEdit`, `getRecipeAccess`, `structureRecipe`, `LlmClient`.
- Produces: `MAX_SEGMENT_CHARS = 2000`; `editSegment(db, recipeId, idx, text): Promise<{ ok: true; edited: boolean } | { ok: false; reason: "not_found" | "too_long" }>` (empty or unchanged text resets to the original); `syncTranscript(db, recipeId): Promise<void>`; `restructureRecipe(db, llm, recipeId): Promise<{ ok: true } | { ok: false }>`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/segments.test.ts
import { describe, it, expect, vi } from "vitest";
import { makeTestDb } from "@/tests/helpers/test-db";
import { upsertUserByPhone } from "@/lib/users";
import { createRecipe, getRecipeById, listSegments } from "@/lib/recipes";
import { editSegment, restructureRecipe, MAX_SEGMENT_CHARS } from "@/lib/segments";

async function setup() {
  const db = await makeTestDb();
  const u = await upsertUserByPhone(db, "+919876543210", "A");
  const r = await createRecipe(db, u.id, "p", 60);
  for (const [i, t] of ["aloo kaato", "tel garam karo", "namak daalo"].entries())
    await db.query("insert into segments (recipe_id, idx, text, start_sec, end_sec) values ($1, $2, $3, $4, $5)", [r.id, i, t, i * 3, i * 3 + 2]);
  await db.query("update recipes set status = 'ready', transcript_text = 'aloo kaato tel garam karo namak daalo' where id = $1", [r.id]);
  return { db, r };
}

describe("editSegment", () => {
  it("stores the edit, keeps the original, and rebuilds the transcript in order", async () => {
    const { db, r } = await setup();
    expect(await editSegment(db, r.id, 1, "  tel garam karo, jeera daalo ")).toEqual({ ok: true, edited: true });
    const seg = (await listSegments(db, r.id))[1];
    expect(seg.text).toBe("tel garam karo");
    expect(seg.edited_text).toBe("tel garam karo, jeera daalo");
    expect((await getRecipeById(db, r.id))?.transcript_text).toBe("aloo kaato tel garam karo, jeera daalo namak daalo");
  });
  it("[review focus 5] empty, whitespace or unchanged text resets to the original", async () => {
    const { db, r } = await setup();
    await editSegment(db, r.id, 0, "pyaaz kaato");
    expect(await editSegment(db, r.id, 0, "   ")).toEqual({ ok: true, edited: false });
    expect((await listSegments(db, r.id))[0].edited_text).toBeNull();
    await editSegment(db, r.id, 0, "pyaaz kaato");
    expect(await editSegment(db, r.id, 0, "aloo kaato")).toEqual({ ok: true, edited: false });
    expect((await getRecipeById(db, r.id))?.transcript_text).toBe("aloo kaato tel garam karo namak daalo");
  });
  it("[review focus 5] rejects an index that does not exist and text that is too long", async () => {
    const { db, r } = await setup();
    expect(await editSegment(db, r.id, 9, "x")).toEqual({ ok: false, reason: "not_found" });
    expect(await editSegment(db, r.id, -1, "x")).toEqual({ ok: false, reason: "not_found" });
    expect(await editSegment(db, r.id, 0, "x".repeat(MAX_SEGMENT_CHARS + 1))).toEqual({ ok: false, reason: "too_long" });
  });
  it("[review focus 5] normalises decomposed Unicode so search matches", async () => {
    const { db, r } = await setup();
    await editSegment(db, r.id, 0, "आलू".normalize("NFD") + " काटो");
    expect((await listSegments(db, r.id))[0].edited_text).toBe("आलू काटो".normalize("NFC"));
  });
});

describe("restructureRecipe", () => {
  it("re-runs structuring on the corrected transcript", async () => {
    const { db, r } = await setup();
    await editSegment(db, r.id, 0, "pyaaz kaato");
    const llm = { complete: vi.fn().mockResolvedValue(JSON.stringify({ title: "Pyaaz", ingredients: [{ name: "pyaaz" }], steps: ["kaato"] })) };
    expect(await restructureRecipe(db, llm, r.id)).toEqual({ ok: true });
    expect(llm.complete.mock.calls[0][1]).toContain("pyaaz kaato");
    const rec = (await getRecipeById(db, r.id))!;
    expect(rec.title).toBe("Pyaaz");
    expect(rec.note).toBeNull();
  });
  it("keeps the old recipe when the LLM fails", async () => {
    const { db, r } = await setup();
    await db.query("update recipes set title = 'Old' where id = $1", [r.id]);
    expect(await restructureRecipe(db, { complete: vi.fn().mockResolvedValue("garbage") }, r.id)).toEqual({ ok: false });
    expect((await getRecipeById(db, r.id))?.title).toBe("Old");
  });
});
```

- [ ] **Step 2: Run to fail** — `npx vitest run tests/segments.test.ts` — Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
// lib/segments.ts
import type { Db } from "@/lib/db";
import type { LlmClient } from "@/lib/llm";
import { structureRecipe } from "@/lib/structure";

export const MAX_SEGMENT_CHARS = 2000;

export async function syncTranscript(db: Db, recipeId: string): Promise<void> {
  await db.query(
    "update recipes set transcript_text = coalesce((select string_agg(coalesce(edited_text, text), ' ' order by idx) from segments where recipe_id = $1), ''), updated_at = now() where id = $1",
    [recipeId],
  );
}

export async function editSegment(db: Db, recipeId: string, idx: number, text: string): Promise<{ ok: true; edited: boolean } | { ok: false; reason: "not_found" | "too_long" }> {
  const t = text.normalize("NFC").trim();
  if (t.length > MAX_SEGMENT_CHARS) return { ok: false, reason: "too_long" };
  const row = (await db.query<{ text: string }>("select text from segments where recipe_id = $1 and idx = $2", [recipeId, idx]))[0];
  if (!row) return { ok: false, reason: "not_found" };
  const edited = t !== "" && t !== row.text;
  await db.query("update segments set edited_text = $3 where recipe_id = $1 and idx = $2", [recipeId, idx, edited ? t : null]);
  await syncTranscript(db, recipeId);
  return { ok: true, edited };
}

export async function restructureRecipe(db: Db, llm: LlmClient, recipeId: string): Promise<{ ok: true } | { ok: false }> {
  const row = (await db.query<{ transcript_text: string | null }>("select transcript_text from recipes where id = $1", [recipeId]))[0];
  if (!row?.transcript_text) return { ok: false };
  try {
    const r = await structureRecipe(row.transcript_text, llm);
    await db.query("update recipes set title = $2, ingredients = $3::jsonb, steps = $4::jsonb, note = null, updated_at = now() where id = $1", [recipeId, r.title, JSON.stringify(r.ingredients), JSON.stringify(r.steps)]);
    return { ok: true };
  } catch {
    return { ok: false };
  }
}
```

Normalise text from Sarvam and the LLM: in `lib/stt/sarvam.ts` `parseSarvamOutput`, change the chunk mapping to `text: text.normalize("NFC").trim()` and the transcript to `(o.transcript ?? segments.map((s) => s.text).join(" ")).normalize("NFC").trim()`. In `lib/structure.ts` change the title rule to `title: z.string().min(1).transform((s) => s.normalize("NFC"))`.

- [ ] **Step 4: Routes (owner or edit role only)**

```ts
// app/api/recipes/[id]/segments/[idx]/route.ts
import { NextResponse } from "next/server";
import { canEdit, getRecipeAccess } from "@/lib/access";
import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { isUuid } from "@/lib/ids";
import { editSegment } from "@/lib/segments";

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string; idx: string }> }) {
  const user = await getSessionUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });
  const { id, idx } = await ctx.params;
  if (!isUuid(id) || !/^\d{1,6}$/.test(idx)) return new NextResponse("Not found", { status: 404 });
  const access = await getRecipeAccess(getDb(), id, user);
  if (!access) return new NextResponse("Not found", { status: 404 });
  if (!canEdit(access.role)) return new NextResponse("Forbidden", { status: 403 });
  const body = (await request.json().catch(() => null)) as { text?: unknown } | null;
  if (typeof body?.text !== "string") return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const r = await editSegment(getDb(), id, Number(idx), body.text);
  if (!r.ok) return NextResponse.json({ error: r.reason === "too_long" ? "That is too long." : "Not found" }, { status: r.reason === "too_long" ? 400 : 404 });
  return NextResponse.json({ ok: true, edited: r.edited });
}
```

```ts
// app/api/recipes/[id]/restructure/route.ts
import { NextResponse } from "next/server";
import { canEdit, getRecipeAccess } from "@/lib/access";
import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { gatewayLlm } from "@/lib/llm";
import { isUuid } from "@/lib/ids";
import { restructureRecipe } from "@/lib/segments";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });
  const { id } = await ctx.params;
  if (!isUuid(id)) return new NextResponse("Not found", { status: 404 });
  const access = await getRecipeAccess(getDb(), id, user);
  if (!access) return new NextResponse("Not found", { status: 404 });
  if (!canEdit(access.role)) return new NextResponse("Forbidden", { status: 403 });
  const r = await restructureRecipe(getDb(), gatewayLlm(), id);
  return r.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "Could not update the recipe. Your corrections are saved." }, { status: 502 });
}
```

- [ ] **Step 5: Run all tests, typecheck** — `npx vitest run && npx tsc --noEmit` — Expected: PASS (the Plan 1 Sarvam and structure tests still pass with NFC added).

- [ ] **Step 6: Commit** — `git add -A && git commit -m "feat: segment editing with transcript sync and recipe update"`

---

### Task 7: Seekable audio

**Files:**
- Create: `lib/recorder/fix-duration.ts`
- Modify: `lib/review.ts` (new, `parseByteRange`), `app/api/audio/[id]/route.ts`, `lib/upload-recording.ts`
- Test: `tests/review.test.ts` (range part), `tests/recorder/fix-duration.test.ts`

**Interfaces:**
- Produces: `parseByteRange(header: string | null, size: number): { start: number; end: number } | "invalid" | null` (null means no Range header); `fixDuration(blob: Blob, durationMs: number): Promise<Blob>` (returns the original blob for non-WebM or on any error).

- [ ] **Step 1: Write the failing tests**

```ts
// tests/review.test.ts
import { describe, it, expect } from "vitest";
import { parseByteRange } from "@/lib/review";
describe("parseByteRange", () => {
  it("returns null when there is no Range header", () => expect(parseByteRange(null, 1000)).toBeNull());
  it("parses start-end, open-ended and suffix ranges", () => {
    expect(parseByteRange("bytes=0-99", 1000)).toEqual({ start: 0, end: 99 });
    expect(parseByteRange("bytes=500-", 1000)).toEqual({ start: 500, end: 999 });
    expect(parseByteRange("bytes=-100", 1000)).toEqual({ start: 900, end: 999 });
  });
  it("clamps an end past the file and rejects impossible ranges", () => {
    expect(parseByteRange("bytes=900-5000", 1000)).toEqual({ start: 900, end: 999 });
    expect(parseByteRange("bytes=2000-3000", 1000)).toBe("invalid");
    expect(parseByteRange("bytes=50-10", 1000)).toBe("invalid");
    expect(parseByteRange("items=0-5", 1000)).toBe("invalid");
    expect(parseByteRange("bytes=0-5,10-20", 1000)).toBe("invalid");
  });
});
```

```ts
// tests/recorder/fix-duration.test.ts
import { describe, it, expect } from "vitest";
import { fixDuration } from "@/lib/recorder/fix-duration";
describe("fixDuration", () => {
  it("passes non-WebM audio through untouched", async () => {
    const b = new Blob([new Uint8Array([1, 2, 3])], { type: "audio/mp4" });
    expect(await fixDuration(b, 5000)).toBe(b);
  });
  it("falls back to the original blob when the patch fails on garbage", async () => {
    const b = new Blob([new Uint8Array([1, 2, 3])], { type: "audio/webm" });
    const out = await fixDuration(b, 5000);
    expect(out.size).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run to fail** — `npx vitest run tests/review.test.ts tests/recorder/fix-duration.test.ts` — Expected: FAIL, modules not found.

- [ ] **Step 3: Install and read the library, then implement.**

```bash
npm i fix-webm-duration
sed -n 1,60p node_modules/fix-webm-duration/README.md
```

Check how the function is called (callback or promise). The wrapper below handles both; adjust only if the README shows a different export.

```ts
// lib/recorder/fix-duration.ts
// Chrome's MediaRecorder writes WebM without a duration, which breaks seeking. Patch it in before upload.
export async function fixDuration(blob: Blob, durationMs: number): Promise<Blob> {
  if (!blob.type.includes("webm")) return blob;
  try {
    const mod = (await import("fix-webm-duration")) as unknown as { default?: unknown };
    const fn = (mod.default ?? mod) as (b: Blob, ms: number, cb?: (fixed: Blob) => void) => unknown;
    return await new Promise<Blob>((resolve, reject) => {
      const r = fn(blob, durationMs, (fixed) => resolve(fixed));
      if (r && typeof (r as Promise<Blob>).then === "function") (r as Promise<Blob>).then(resolve, reject);
    });
  } catch {
    return blob;
  }
}
```

In `lib/upload-recording.ts` add `import { fixDuration } from "@/lib/recorder/fix-duration";` and change the upload line to `const stored = await upload(pathname, await fixDuration(blob, durationSec * 1000), { ... });` (keep the existing options). If the garbage-input test hangs because the library never calls back, add a 5-second `Promise.race` timeout to the wrapper that resolves with the original blob.

- [ ] **Step 4: Range parsing and the audio route**

```ts
// lib/review.ts
export function parseByteRange(header: string | null, size: number): { start: number; end: number } | "invalid" | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === "" && m[2] === "")) return "invalid";
  let start: number, end: number;
  if (m[1] === "") { const n = Number(m[2]); start = Math.max(0, size - n); end = size - 1; }
  else { start = Number(m[1]); end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1); }
  if (!(start <= end) || start >= size) return "invalid";
  return { start, end };
}
```

Replace the tail of `app/api/audio/[id]/route.ts` (after the access check) so it buffers the file and serves byte ranges. Voice recordings are a few MB, so buffering is fine for v1; note the limit.

```ts
  const result = await get(access.recipe.audio_pathname, { access: "private" });
  if (!result || result.statusCode !== 200) return new NextResponse("Not found", { status: 404 });
  const bytes = new Uint8Array(await new Response(result.stream).arrayBuffer());
  const type = result.blob.contentType;
  const base = { "Content-Type": type, "Accept-Ranges": "bytes", "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store" };
  const range = parseByteRange(req.headers.get("range"), bytes.length);
  if (range === "invalid") return new NextResponse(null, { status: 416, headers: { ...base, "Content-Range": `bytes */${bytes.length}` } });
  if (!range) return new NextResponse(bytes, { headers: { ...base, "Content-Length": String(bytes.length) } });
  const part = bytes.subarray(range.start, range.end + 1);
  return new NextResponse(part, { status: 206, headers: { ...base, "Content-Range": `bytes ${range.start}-${range.end}/${bytes.length}`, "Content-Length": String(part.length) } });
```

Rename the first parameter `_req` to `req` and add `import { parseByteRange } from "@/lib/review";`.

- [ ] **Step 5: Run tests, typecheck** — `npx vitest run && npx tsc --noEmit` — Expected: PASS.

- [ ] **Step 6: Verify on the preview deployment (manual).** Record a 30-second recipe, open it, and check: the audio shows a duration, dragging the seek bar works, and `curl -s -D- -o /dev/null -H "Range: bytes=0-99" <audio url with session cookie>` returns `206`. If the seek bar still fails on WebM, record that in the ledger: the fallback is a 16 kHz WAV recorder (an `AudioWorklet` writing PCM into the same chunk store), which is a new plan.

- [ ] **Step 7: Commit** — `git add -A && git commit -m "feat: seekable audio via WebM duration patch and byte ranges"`

---

### Task 8: Review screen (tap to hear, tap to fix)

**Files:**
- Modify: `lib/review.ts` (add `activeSegmentIndex`)
- Create: `components/transcript-review.tsx`
- Modify: `app/recipes/[id]/page.tsx`
- Test: `tests/review.test.ts`

**Interfaces:**
- Consumes: `listSegments` rows, `canEdit(role)`, the PATCH and restructure routes (Task 6).
- Produces: `activeSegmentIndex(segments: { start_sec: number; end_sec: number }[], t: number): number` (index of the last segment starting at or before `t`; `-1` before the first or for an empty list).

- [ ] **Step 1: Write the failing test.** Add to `tests/review.test.ts`:

```ts
import { activeSegmentIndex } from "@/lib/review";
const segs = [{ start_sec: 0, end_sec: 2 }, { start_sec: 2.5, end_sec: 5 }, { start_sec: 6, end_sec: 9 }];
describe("activeSegmentIndex", () => {
  it("finds the segment being played, holding the previous one across gaps", () => {
    expect(activeSegmentIndex(segs, 0)).toBe(0);
    expect(activeSegmentIndex(segs, 1.9)).toBe(0);
    expect(activeSegmentIndex(segs, 2.2)).toBe(0); // gap between 2 and 2.5
    expect(activeSegmentIndex(segs, 2.5)).toBe(1);
    expect(activeSegmentIndex(segs, 100)).toBe(2);
  });
  it("handles empty lists and times before the first segment", () => {
    expect(activeSegmentIndex([], 3)).toBe(-1);
    expect(activeSegmentIndex([{ start_sec: 1, end_sec: 2 }], 0.5)).toBe(-1);
  });
  it("handles the single zero-time fallback segment", () => {
    expect(activeSegmentIndex([{ start_sec: 0, end_sec: 0 }], 12)).toBe(0);
  });
});
```

- [ ] **Step 2: Run to fail** — `npx vitest run tests/review.test.ts` — Expected: FAIL (`activeSegmentIndex` not exported).

- [ ] **Step 3: Implement the helper.** Append to `lib/review.ts`:

```ts
export function activeSegmentIndex(segments: { start_sec: number; end_sec: number }[], t: number): number {
  let lo = 0, hi = segments.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (segments[mid].start_sec <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}
```

- [ ] **Step 4: The review component**

```tsx
// components/transcript-review.tsx
"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { activeSegmentIndex } from "@/lib/review";

type Seg = { idx: number; text: string; edited_text: string | null; start_sec: number; end_sec: number };

export function TranscriptReview({ recipeId, segments: initial, canEdit }: { recipeId: string; segments: Seg[]; canEdit: boolean }) {
  const router = useRouter();
  const audioRef = useRef<HTMLAudioElement>(null);
  const [segments, setSegments] = useState(initial);
  const [active, setActive] = useState(-1);
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);

  const shown = (s: Seg) => s.edited_text ?? s.text;

  function play(s: Seg) {
    const a = audioRef.current;
    if (!a) return;
    a.currentTime = s.start_sec;
    void a.play();
  }

  async function save(s: Seg) {
    setBusy(true); setError("");
    const res = await fetch(`/api/recipes/${recipeId}/segments/${s.idx}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: draft }) });
    setBusy(false);
    if (!res.ok) { setError((await res.json().catch(() => ({}))).error ?? "Could not save"); return; }
    const { edited } = (await res.json()) as { edited: boolean };
    setSegments((all) => all.map((x) => (x.idx === s.idx ? { ...x, edited_text: edited ? draft.normalize("NFC").trim() : null } : x)));
    setEditing(null); setDirty(true);
  }

  async function updateRecipe() {
    setBusy(true); setError("");
    const res = await fetch(`/api/recipes/${recipeId}/restructure`, { method: "POST" });
    setBusy(false);
    if (!res.ok) { setError((await res.json().catch(() => ({}))).error ?? "Could not update the recipe"); return; }
    setDirty(false); router.refresh();
  }

  return (
    <section className="space-y-3">
      <audio ref={audioRef} controls className="w-full" src={`/api/audio/${recipeId}`} onTimeUpdate={(e) => setActive(activeSegmentIndex(segments, e.currentTarget.currentTime))} />
      <h2 className="font-semibold">Transcript</h2>
      <p className="text-xs text-neutral-500">Tap a line to hear it.{canEdit ? " Tap Fix to correct it." : ""}</p>
      <ol className="space-y-2">
        {segments.map((s, i) => (
          <li key={s.idx} className={`rounded border p-3 ${i === active ? "border-red-400 bg-red-50" : ""}`}>
            {editing === s.idx ? (
              <div className="space-y-2">
                <textarea className="w-full rounded border p-2" rows={3} value={draft} onChange={(e) => setDraft(e.target.value)} />
                <div className="flex gap-2">
                  <button disabled={busy} className="rounded bg-black px-3 py-1 text-white" onClick={() => save(s)}>Save</button>
                  <button className="rounded border px-3 py-1" onClick={() => setEditing(null)}>Cancel</button>
                  <button className="ml-auto text-sm underline" onClick={() => setDraft(s.text)}>Use original</button>
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-3">
                <button className="flex-1 text-left leading-relaxed" onClick={() => play(s)}>{shown(s)}{s.edited_text && <span className="ml-2 text-xs text-neutral-500">(fixed)</span>}</button>
                {canEdit && <button className="text-sm underline" onClick={() => { setEditing(s.idx); setDraft(shown(s)); }}>Fix</button>}
              </div>
            )}
          </li>
        ))}
      </ol>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {canEdit && dirty && (
        <button disabled={busy} className="w-full rounded bg-black p-3 text-white" onClick={updateRecipe}>Update the recipe from my corrections</button>
      )}
    </section>
  );
}
```

- [ ] **Step 5: Use it on the recipe page.** In `app/recipes/[id]/page.tsx` import `TranscriptReview` and `canEdit` (from `@/lib/access`), remove the standalone `<audio ...>` line and the old Transcript `<section>`, and render after the steps:

```tsx
      {segments.length > 0 ? (
        <TranscriptReview recipeId={recipe.id} segments={segments} canEdit={canEdit(role)} />
      ) : (
        <audio controls className="w-full" src={`/api/audio/${recipe.id}`} />
      )}
```

- [ ] **Step 6: Run tests, typecheck, lint, build** — `npx vitest run && npx tsc --noEmit && npm run lint && npm run build` — Expected: all PASS.

- [ ] **Step 7: Commit** — `git add -A && git commit -m "feat: review screen with tap-to-hear and tap-to-fix"`

---

### Task 9: Search

**Files:**
- Create: `lib/search.ts`
- Modify: `app/page.tsx`
- Test: `tests/search.test.ts`

**Interfaces:**
- Consumes: `Recipe`, `shares`.
- Produces: `likePattern(q: string): string` (escapes `\`, `%`, `_`); `searchRecipes(db, user: { id: string; phone: string }, q: string, limit?: number): Promise<Recipe[]>` over title and transcript, for the user's own and shared recipes.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/search.test.ts
import { describe, it, expect } from "vitest";
import { makeTestDb } from "@/tests/helpers/test-db";
import { upsertUserByPhone } from "@/lib/users";
import { createRecipe } from "@/lib/recipes";
import { addShare } from "@/lib/access";
import { likePattern, searchRecipes } from "@/lib/search";

async function setup() {
  const db = await makeTestDb();
  const me = await upsertUserByPhone(db, "+919876543210", "Me");
  const other = await upsertUserByPhone(db, "+919123456789", "Other");
  const mk = async (owner: string, title: string | null, text: string) => {
    const r = await createRecipe(db, owner, "p", 60);
    await db.query("update recipes set title = $2, transcript_text = $3, status = 'ready' where id = $1", [r.id, title, text]);
    return r;
  };
  return { db, me, other, mk };
}

describe("search", () => {
  it("escapes wildcard characters", () => expect(likePattern("50%_off\\")).toBe("%50\\%\\_off\\\\%"));
  it("[review focus 4] matches Devanagari and Tamil substrings, and Latin ignoring case", async () => {
    const { db, me, mk } = await setup();
    await mk(me.id, "आलू गोभी", "पहले आलू काटो फिर तेल गरम करो");
    await mk(me.id, "சாம்பார்", "முதலில் பருப்பை வேக வைக்கவும்");
    await mk(me.id, "Aloo Paratha", "knead the atta");
    expect((await searchRecipes(db, me, "आलू")).length).toBe(1);
    expect((await searchRecipes(db, me, "பருப்பை")).length).toBe(1);
    expect((await searchRecipes(db, me, "ATTA")).length).toBe(1);
    expect((await searchRecipes(db, me, "aloo")).length).toBe(1);
  });
  it("[review focus 4] % and _ in the query are literal, not wildcards", async () => {
    const { db, me, mk } = await setup();
    await mk(me.id, "Plain", "use 50% less salt");
    await mk(me.id, "Other", "use fifty less salt");
    expect((await searchRecipes(db, me, "50%")).map((r) => r.title)).toEqual(["Plain"]);
    expect(await searchRecipes(db, me, "%")).toHaveLength(1);
    expect(await searchRecipes(db, me, "_")).toEqual([]);
  });
  it("[review focus 4] never returns another user's recipes, but does return shared ones", async () => {
    const { db, me, other, mk } = await setup();
    const theirs = await mk(other.id, "Secret", "secret masala");
    expect(await searchRecipes(db, me, "masala")).toEqual([]);
    await addShare(db, theirs, other, "9876543210", "view");
    expect((await searchRecipes(db, me, "masala")).map((r) => r.id)).toEqual([theirs.id]);
  });
  it("returns nothing for an empty query and matches decomposed input", async () => {
    const { db, me, mk } = await setup();
    await mk(me.id, "आलू", "आलू काटो");
    expect(await searchRecipes(db, me, "   ")).toEqual([]);
    expect((await searchRecipes(db, me, "आलू".normalize("NFD"))).length).toBe(1);
  });
});
```

- [ ] **Step 2: Run to fail** — `npx vitest run tests/search.test.ts` — Expected: FAIL, module not found.

- [ ] **Step 3: Implement.** Plain `ILIKE` rather than trigram indexes: per-user collections are small, and Postgres trigram handling of Indian combining marks was not verified. Add an index later if a user's library grows to thousands.

```ts
// lib/search.ts
import type { Db } from "@/lib/db";
import type { Recipe } from "@/lib/recipes";

export const likePattern = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

export async function searchRecipes(db: Db, user: { id: string; phone: string }, q: string, limit = 50): Promise<Recipe[]> {
  const query = q.normalize("NFC").trim().slice(0, 100);
  if (!query) return [];
  return db.query<Recipe>(
    `select r.id, r.owner_id, r.title, r.status, r.note, r.error, r.language, r.audio_pathname, r.duration_sec, r.stt_job_id, r.transcript_text, r.ingredients, r.steps, r.created_at
     from recipes r
     where (r.owner_id = $1 or exists (select 1 from shares s where s.recipe_id = r.id and s.phone = $2))
       and (r.title ilike $3 escape '\\' or r.transcript_text ilike $3 escape '\\')
     order by r.created_at desc limit $4`,
    [user.id, user.phone, likePattern(query), limit],
  );
}
```

- [ ] **Step 4: Search on the home screen.** In `app/page.tsx` change the component signature to `export default async function Home({ searchParams }: { searchParams: Promise<{ q?: string }> })`, add `const { q } = await searchParams;`, and:

```tsx
  const query = (q ?? "").trim();
  const recipes = query ? await searchRecipes(getDb(), user, query) : await listRecipes(getDb(), user.id);
  const shared = query ? [] : await listSharedWithMe(getDb(), user);
```

Add above the list (import `searchRecipes` from `@/lib/search`):

```tsx
      <form action="/" className="flex gap-2">
        <input name="q" defaultValue={query} className="min-w-0 flex-1 rounded border p-3" placeholder="Search recipes" />
        <button className="rounded border px-4">Search</button>
      </form>
      {query && <p className="text-sm text-neutral-600">{recipes.length} result{recipes.length === 1 ? "" : "s"} for “{query}” · <Link className="underline" href="/">Clear</Link></p>}
```

and change the empty-state text to `{query ? "No recipes match." : "No recipes yet. Record your first one."}`.

- [ ] **Step 5: Run tests, typecheck, lint, build** — `npx vitest run && npx tsc --noEmit && npm run lint && npm run build` — Expected: all PASS.

- [ ] **Step 6: Commit** — `git add -A && git commit -m "feat: search recipes by title and transcript in any script"`

---

### Task 10: Live verification (manual, owner)

**Files:** record results in `docs/device-checks.md` (append a "Plan 2" section).

- [ ] **Step 1: Deploy a preview with the WhatsApp variables set** (`WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_OTP_TEMPLATE_NAME`, `WHATSAPP_API_VERSION`, and **no** `AUTH_MODE`). Run `npm run migrate` for migrations 002 to 004.

- [ ] **Step 2: Run these checks on a real phone and a second phone:**

| Check | Pass condition |
|---|---|
| Sign in with a real number | Code arrives on WhatsApp within a minute; signing in works; first time asks for a name |
| Wrong code 5 times | Locked message; a new code works after waiting |
| Code requested twice quickly | Second request says to wait |
| Record, wait for Ready | Review screen shows segments; tapping a line plays from that line; the current line highlights |
| Seek bar | Duration shows and dragging works, on Chrome and (if available) iPhone Safari |
| Fix a wrong word, then update the recipe | Corrected text appears; search finds the corrected word; ingredients and steps reflect it |
| Share with the second phone as "view" | Second phone sees it under "Shared with you", cannot see Fix or Share |
| Change to "edit", then remove | Edit works; after removal the recipe 404s and the audio does not play |
| Search a Hindi word | Finds the recipe |
| Leave the record page mid-recording | Mic indicator turns off; the recording appears under "Upload now" |

- [ ] **Step 3: Commit the results** — `git add docs/device-checks.md && git commit -m "docs: Plan 2 live check results"`

**Gate:** any failed check in the sign-in, sharing or revocation rows is a blocker for inviting real users.

---

## Self-Review

**Spec coverage:** WhatsApp OTP sign-in (Task 4), share by phone with view and edit (Task 5), review screen with synced playback and tap-to-fix, edits never altering audio or the original text (Tasks 6 and 8), search over title and transcript in any language (Task 9), consent line (Task 3), private audio only through an authenticated route (Tasks 2, 5, 7), failure handling and recovery from Plan 1 kept. Deliberately not here: Hindi screens, re-recording a section, uncertain-word underlining (no confidence data from Sarvam), groups, SMS fallback, per-recipe consent records.

**Deferred from Plan 1 and addressed here:** M2 (Task 2), M3 (Task 2), M5 (Tasks 2 and 5), M7 and M9 (Task 3), M13 (Task 7). Still deferred: M4, M6, M8, M10 (verify the real webhook payload in Plan 1 Task 12), M11, M12.

**Placeholder scan:** none. Two items depend on a real call and say so with a verification step: the `fix-webm-duration` calling style (Task 7 Step 3) and byte-range behaviour on the deployed route (Task 7 Step 6).

**Type consistency:** `Role`, `getRecipeAccess` and `canEdit` (Task 5) are used unchanged in Tasks 6 and 8. `Uploader` with `sessionId` (Task 2) matches the component closures. `activeSegmentIndex` and `parseByteRange` share `lib/review.ts` without clashing. Migration numbers 002 to 004 match the files named in each task.

**Review Focus coverage:** items 1 to 5 each have a test in the task named in brackets.
