# Mother Tongue Kitchen: Plan 1, Record to Recipe

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A signed-in user records a spoken recipe on their phone, it uploads safely, Sarvam transcribes it, an LLM structures it, and the user sees the recipe with the original audio.

**Architecture:** Next.js (App Router) PWA. The browser records audio in 5-second chunks into IndexedDB, joins and uploads to a private Vercel Blob store, then creates a recipe row in Neon Postgres. A server pipeline (a state machine stored in the `recipes.status` column) starts a Sarvam batch job, completes on Sarvam's webhook, then calls an LLM to structure the transcript. All external services sit behind small interfaces so the pipeline is tested with fakes.

**Tech Stack:** Next.js 16 App Router, TypeScript, Tailwind, Vitest, Neon Postgres (`@neondatabase/serverless`), PGlite for tests, Vercel Blob (private), `jose` sessions, `idb`, `zod`, Sarvam `sarvamai` SDK, Vercel AI Gateway.

**Spec:** `docs/superpowers/specs/2026-10-06-mother-tongue-kitchen-design.md`

**Scope of this plan (Plan 1 of 2):** spec build-order steps 1-3 plus a dev-only login. **Plan 2** (written after the spike results are in): review screen with tap-to-fix, WhatsApp OTP, sharing, search, and the audio remux decision. Not in this plan: those four items, Hindi UI.

## Global Constraints

- India only: phone numbers accepted are Indian mobiles (`+91` followed by a 10-digit number starting 6-9).
- Default git branch is `master`. Commit with the repo-local noreply identity already configured. Never commit `.env*` (except `.env.example`) or audio files.
- Audio is private: stored in a **private** Vercel Blob store and only served through an authenticated route.
- The original STT text is never overwritten. Transcript edits (Plan 2) go in `edited_text`.
- Structured recipe text stays in the **original language**, never translated.
- Sarvam: model `saaras:v4`, mode `transcribe`, chunk-level timestamps only (no word timing is available).
- Screens are English only. UI is normal-sized and uncluttered (no oversized accessibility mode).
- Record button is one tap from the home screen. No title or form before recording.
- Secrets only in `.env.local` (gitignored). `.env.example` lists every key with blank values.

## Review Focus

Inputs the spec implies but no task would otherwise test, most likely first. Each has a test in the task named in brackets.

1. **Tapping stop immediately (under 2 seconds or zero bytes):** must not upload an empty recipe; the user sees "That was too short, try again." [Task 6]
2. **Silent or noise-only audio:** Sarvam returns empty text. The recipe must reach `ready` with a "no speech found" note, not crash or stay stuck, and the LLM must not be called. [Task 9]
3. **Duplicate or early webhook delivery:** Sarvam may call twice, or call before our `transcribing` write lands. The pipeline must be idempotent: one transcript, one LLM call, no error. [Task 9]
4. **Phone number typed in different formats** (`98765 43210`, `+91-98765-43210`, `09876543210`): all resolve to the same user. [Task 4]
5. **Opening another user's recipe or audio by id:** must return not found, never the data. [Task 10]

---

## File Structure

```
package.json, tsconfig.json, next.config.ts, vitest.config.ts   (scaffold)
vercel.json                          cron sweep for stuck jobs
db/migrations/001_init.sql           users, recipes, segments
lib/env.ts                           requireEnv()
lib/db.ts                            Db interface + Neon implementation
lib/migrate.ts                       runMigrations(db, sqlFiles)
scripts/migrate.ts                   CLI wrapper
lib/phone.ts                         normalizePhone()
lib/session.ts                       signSession / verifySession (jose)
lib/users.ts                         upsertUserByPhone()
lib/auth.ts                          getSessionUser() (cookie -> user)
app/api/auth/dev-login/route.ts      dev-only login
app/login/page.tsx                   dev login form
lib/recorder/chunk-store.ts          IndexedDB crash-safe chunk storage
lib/recorder/join.ts                 joinChunks()
lib/recorder/pending.ts              uploadPending() recovery
lib/recorder/use-recorder.ts         MediaRecorder + wake lock hook
lib/upload-recording.ts              client upload to private Blob
app/api/recordings/upload/route.ts   Blob client-upload token route
components/recorder.tsx              record screen UI
components/pending-uploads.tsx       "Upload saved recordings" banner
lib/stt/types.ts                     Transcript, SttProvider
lib/stt/sarvam.ts                    parseSarvamOutput + SarvamProvider
lib/llm.ts                           LlmClient + gatewayLlm()
lib/structure.ts                     structureRecipe()
lib/recipes.ts                       recipe/segment queries
lib/pipeline.ts                      startTranscription / completeTranscription
app/api/recipes/route.ts             POST create, GET list
app/api/recipes/[id]/route.ts        GET one
app/api/recipes/[id]/retry/route.ts  POST retry
app/api/audio/[id]/route.ts          authenticated audio stream
app/api/sarvam/webhook/route.ts      Sarvam job callback
app/api/cron/sweep/route.ts          finish stuck jobs
app/page.tsx, app/record/page.tsx, app/recipes/[id]/page.tsx
components/recipe-status.tsx         polling status badge
scripts/sarvam-spike.ts              throwaway spike
docs/spike/sarvam-findings.md        spike results
tests/**                             Vitest tests mirroring lib/
```

---

### Task 0: Start the slow external approvals (manual, day 1)

**Files:** none (account setup). Record what you did in `docs/external-setup.md` (no secrets).

These have waits outside our control. Start them first and continue with Task 1 while they run.

- [ ] **Step 1: Sarvam.** Create an account at the Sarvam dashboard, create an API subscription key, put it in `.env.local` as `SARVAM_API_KEY`.
- [ ] **Step 2: Meta / WhatsApp.** Create a Meta Business account and start business verification. Create a WhatsApp Business Account and add a phone number. Create an **authentication** template with a **copy code** button (language `en_US`, `code_expiration_minutes` 5) named `mtk_login_code`, via the Message Templates API or the dashboard. Template approval is needed before Plan 2.
- [ ] **Step 3: Vercel.** Run `vercel login`, create the project from this repo later in Task 12.
- [ ] **Step 4: Record progress.**

```bash
mkdir -p docs && cat > docs/external-setup.md <<'EOF'
# External setup status (no secrets here)
- Sarvam key: created YYYY-MM-DD
- Meta business verification: submitted YYYY-MM-DD, status: pending
- WhatsApp template mtk_login_code: submitted YYYY-MM-DD, status: pending
EOF
git add docs/external-setup.md && git commit -m "docs: track external approvals"
```

(Replace `YYYY-MM-DD` with the real dates before committing.)

---

### Task 1: Sarvam spike (throwaway, decides Plan 2)

**Files:**
- Create: `scripts/sarvam-spike.ts`
- Create: `docs/spike/sarvam-findings.md`

**Interfaces:**
- Produces: the exact working SDK call sequence (create job, upload, start, poll, download) and answers to the questions below, which Task 7 copies into `SarvamProvider`.

Questions this spike must answer, each with evidence in the findings file:
1. Does a browser **WebM/Opus** file upload and transcribe? (If not, we need server-side transcoding before Task 7.)
2. Does a **3-6 minute** recording work?
3. Are chunk timestamps usable (about sentence-sized, non-overlapping)?
4. Quality on dish and ingredient names, in 3+ languages, with kitchen noise?
5. Does `keyterms` (Saaras v4) fix dish names?
6. Does the batch **webhook** (`callback`) fire, and what does the SDK call it?
7. Can the Vercel AI Gateway be called with `fetch` at `https://ai-gateway.vercel.sh/v1/chat/completions` (OpenAI-compatible) with the model you plan to use? Record the working model id.

Do not commit audio. Put test recordings in `spike-audio/` (add it to `.gitignore` in Step 1).

- [ ] **Step 1: Prepare**

```bash
cd /mnt/projects/ideas/mother-tongue-kitchen
echo "spike-audio/" >> .gitignore
mkdir -p spike-audio scripts docs/spike
npm init -y >/dev/null && npm i -D tsx typescript @types/node && npm i sarvamai
```

Record 5-10 real narrations on a phone browser or phone recorder in at least Hindi, one South Indian language, and English. Save at least one as `.webm` (record with any web recorder in Chrome) and one longer than 3 minutes into `spike-audio/`.

- [ ] **Step 2: Inspect the SDK surface before writing code**

```bash
grep -rn "createJob\|uploadFiles\|waitUntilComplete\|downloadOutputs\|callback" node_modules/sarvamai/dist --include=*.d.ts | head -40
```

Expected: type declarations for the batch job API. Use the real names you see, not the ones below, if they differ.

- [ ] **Step 3: Write the spike script**

```ts
// scripts/sarvam-spike.ts  (throwaway)
import { SarvamAIClient } from "sarvamai";
import fs from "node:fs";
import path from "node:path";

const key = process.env.SARVAM_API_KEY;
if (!key) throw new Error("SARVAM_API_KEY missing");
const [, , file, lang = "unknown", ...terms] = process.argv;
if (!file) throw new Error("usage: tsx scripts/sarvam-spike.ts <audio> [language_code] [keyterm...]");

const client = new SarvamAIClient({ apiSubscriptionKey: key });

async function main() {
  const job = await client.speechToTextJob.createJob({
    model: "saaras:v4",
    mode: "transcribe",
    languageCode: lang as never,
    ...(terms.length ? { keyterms: terms } : {}),
  } as never);
  await job.uploadFiles([path.resolve(file)]);
  await job.start();
  await job.waitUntilComplete(5, 1800);
  const results = await job.getFileResults();
  console.log(JSON.stringify(results, null, 2));
  const out = `spike-audio/out-${path.basename(file)}`;
  fs.mkdirSync(out, { recursive: true });
  await job.downloadOutputs(out);
  console.log("outputs in", out);
}
main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 4: Run it on every recording and read the JSON**

```bash
set -a; source .env.local; set +a
npx tsx scripts/sarvam-spike.ts spike-audio/hindi-1.webm hi-IN
npx tsx scripts/sarvam-spike.ts spike-audio/hindi-1.webm hi-IN "jeera" "hing" "methi"
```

If TypeScript or a runtime error says a method does not exist, fix the call to match the `.d.ts` you inspected in Step 2 and re-run. Keep the working version.

- [ ] **Step 5: Test the gateway call**

```bash
curl -s https://ai-gateway.vercel.sh/v1/chat/completions \
  -H "Authorization: Bearer $AI_GATEWAY_API_KEY" -H "Content-Type: application/json" \
  -d '{"model":"anthropic/claude-sonnet-5.5","messages":[{"role":"user","content":"say ok"}]}' | head -c 600
```

Expected: a JSON `choices[0].message.content`. If the model id is rejected, list valid ids from the gateway's models endpoint (`GET https://ai-gateway.vercel.sh/v1/models`) and use one that works.

- [ ] **Step 6: Write findings**

Create `docs/spike/sarvam-findings.md` with one section per question above: a yes/no/answer, the evidence (file, job id, a short quoted output), and the **exact working call sequence**. End with a "Decisions for Plan 2" list covering: transcoding needed or not, tap-to-hear feasibility (chunk sizes), and whether `keyterms` should always be sent with a recipe-vocabulary list.

- [ ] **Step 7: Commit (no audio)**

```bash
git status --short   # confirm spike-audio/ is not listed
git add .gitignore scripts/sarvam-spike.ts docs/spike/sarvam-findings.md package.json
git commit -m "spike: Sarvam batch STT findings"
```

**Gate:** If question 1 is "no" (WebM rejected), stop and add a transcoding task before Task 7. Tell the owner.

---

### Task 2: Scaffold the app and test tooling

**Files:**
- Create: Next.js app files at repo root, `vitest.config.ts`, `tests/smoke.test.ts`
- Modify: `.env.example`, `package.json` scripts

**Interfaces:** Produces `npm test`, `npm run dev`, `npm run build`, and `@/*` import alias used by all later tasks.

- [ ] **Step 1: Scaffold in a scratch folder, then copy in** (the repo already has `.gitignore` and `docs/`, which `create-next-app` refuses to overwrite)

```bash
S=/tmp/claude-1000/-mnt-projects-ideas/b20af140-e412-4a6f-8821-1bcf1364932d/scratchpad/mtk-scaffold
rm -rf "$S" && mkdir -p "$S"
cd "$S" && npx create-next-app@latest app --ts --app --tailwind --eslint --no-src-dir --import-alias "@/*" --use-npm --yes
cd /mnt/projects/ideas/mother-tongue-kitchen
rsync -a --exclude .git --exclude .gitignore --exclude package.json --exclude package-lock.json --exclude node_modules "$S/app/" ./
cp "$S/app/package.json" ./package.next.json
```

Then merge dependencies: open `package.json` (from Task 1) and `package.next.json`, copy `dependencies`, `devDependencies`, and `scripts` from the Next file into `package.json`, keeping `sarvamai`, `tsx`, then `rm package.next.json && npm install`.

- [ ] **Step 2: Add runtime and test dependencies**

```bash
npm i @neondatabase/serverless @vercel/blob jose idb zod
npm i -D vitest vite-tsconfig-paths fake-indexeddb @electric-sql/pglite
```

- [ ] **Step 3: Write the failing smoke test**

```ts
// tests/smoke.test.ts
import { describe, it, expect } from "vitest";
describe("tooling", () => {
  it("runs vitest with the @ alias", async () => {
    const { requireEnv } = await import("@/lib/env");
    process.env.__X = "1";
    expect(requireEnv("__X")).toBe("1");
    expect(() => requireEnv("__MISSING")).toThrow(/__MISSING/);
  });
});
```

```ts
// vitest.config.ts
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: { environment: "node", setupFiles: ["fake-indexeddb/auto"], include: ["tests/**/*.test.ts"] },
});
```

- [ ] **Step 4: Run it to see it fail**

Run: `npx vitest run tests/smoke.test.ts`
Expected: FAIL, cannot find module `@/lib/env`.

- [ ] **Step 5: Implement**

```ts
// lib/env.ts
export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable: ${name}`);
  return v;
}
```

- [ ] **Step 6: Add scripts and the new env keys**

In `package.json` add `"test": "vitest run"` and `"migrate": "tsx scripts/migrate.ts"`. Append to `.env.example`:

```
# Dev login (never set in production)
AUTH_MODE=

# Structuring model on the AI Gateway, for example anthropic/claude-sonnet-5.5
STRUCTURE_MODEL=

# Shared secret Sarvam sends in X-SARVAM-JOB-CALLBACK-TOKEN
SARVAM_WEBHOOK_TOKEN=

# Public base URL of the deployed app, for webhook callbacks
APP_BASE_URL=

# Protects /api/cron/sweep
CRON_SECRET=
```

- [ ] **Step 7: Run tests and build**

Run: `npm test && npm run build`
Expected: smoke test PASS, build succeeds.

- [ ] **Step 8: Commit**

```bash
git add -A && git status --short   # confirm no .env.local, node_modules, or audio
git commit -m "chore: scaffold Next.js app with vitest"
```

---

### Task 3: Database layer and migrations

**Files:**
- Create: `lib/db.ts`, `lib/migrate.ts`, `scripts/migrate.ts`, `db/migrations/001_init.sql`, `tests/helpers/test-db.ts`
- Test: `tests/db/migrate.test.ts`

**Interfaces:**
- Produces: `interface Db { query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]> }`; `getDb(): Db`; `runMigrations(db: Db, files: { name: string; sql: string }[]): Promise<string[]>` (returns names applied); `makeTestDb(): Promise<Db>` (migrated in-memory Postgres).

- [ ] **Step 1: Write the failing test**

```ts
// tests/db/migrate.test.ts
import { describe, it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { runMigrations } from "@/lib/migrate";
import { fromPglite } from "@/tests/helpers/test-db";

describe("runMigrations", () => {
  it("applies each file once and is idempotent", async () => {
    const db = fromPglite(new PGlite());
    const files = [{ name: "001_a.sql", sql: "create table t (id int);" }];
    expect(await runMigrations(db, files)).toEqual(["001_a.sql"]);
    expect(await runMigrations(db, files)).toEqual([]);
    await db.query("insert into t values (1)");
    expect((await db.query("select * from t")).length).toBe(1);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run tests/db/migrate.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement**

```ts
// lib/db.ts
import { neon } from "@neondatabase/serverless";
import { requireEnv } from "@/lib/env";

export interface Db {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
}

let cached: Db | undefined;
export function getDb(): Db {
  if (!cached) {
    const sql = neon(requireEnv("DATABASE_URL"));
    cached = {
      async query<T>(text: string, params: unknown[] = []) {
        return (await sql.query(text, params)) as unknown as T[];
      },
    };
  }
  return cached;
}
```

```ts
// lib/migrate.ts
import type { Db } from "@/lib/db";

export async function runMigrations(
  db: Db,
  files: { name: string; sql: string }[],
): Promise<string[]> {
  await db.query("create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())");
  const done = new Set((await db.query<{ name: string }>("select name from schema_migrations")).map((r) => r.name));
  const applied: string[] = [];
  for (const f of [...files].sort((a, b) => a.name.localeCompare(b.name))) {
    if (done.has(f.name)) continue;
    await db.query(f.sql);
    await db.query("insert into schema_migrations (name) values ($1)", [f.name]);
    applied.push(f.name);
  }
  return applied;
}
```

```ts
// tests/helpers/test-db.ts
import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
import path from "node:path";
import type { Db } from "@/lib/db";
import { runMigrations } from "@/lib/migrate";

export function fromPglite(pg: PGlite): Db {
  return {
    async query<T>(text: string, params: unknown[] = []) {
      const res = await pg.query(text, params);
      return res.rows as T[];
    },
  };
}

export function migrationFiles() {
  const dir = path.join(process.cwd(), "db/migrations");
  return fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).map((name) => ({ name, sql: fs.readFileSync(path.join(dir, name), "utf8") }));
}

export async function makeTestDb(): Promise<Db> {
  const db = fromPglite(new PGlite());
  await runMigrations(db, migrationFiles());
  return db;
}
```

Note: PGlite's `query` runs a single statement. Keep each migration to statements the multi-statement path accepts; if `001_init.sql` fails to load in PGlite with multiple statements, change `runMigrations` to split on `;\n` (keep the Neon path unchanged) and re-run the tests.

- [ ] **Step 4: Write the schema**

```sql
-- db/migrations/001_init.sql
create table users (
  id uuid primary key default gen_random_uuid(),
  phone text unique not null,
  name text,
  created_at timestamptz not null default now()
);

create table recipes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references users(id),
  title text,
  status text not null check (status in ('uploaded','transcribing','structuring','ready','failed')),
  note text,
  error text,
  language text,
  audio_pathname text not null,
  duration_sec integer not null,
  stt_job_id text unique,
  transcript_text text,
  ingredients jsonb,
  steps jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index recipes_owner_idx on recipes (owner_id, created_at desc);

create table segments (
  recipe_id uuid not null references recipes(id) on delete cascade,
  idx integer not null,
  text text not null,
  edited_text text,
  start_sec real not null,
  end_sec real not null,
  primary key (recipe_id, idx)
);
```

- [ ] **Step 5: CLI**

```ts
// scripts/migrate.ts
import fs from "node:fs";
import path from "node:path";
import { getDb } from "../lib/db";
import { runMigrations } from "../lib/migrate";

const dir = path.join(process.cwd(), "db/migrations");
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).map((name) => ({ name, sql: fs.readFileSync(path.join(dir, name), "utf8") }));
runMigrations(getDb(), files).then((a) => console.log("applied:", a.length ? a.join(", ") : "none"));
```

- [ ] **Step 6: Run tests**

Run: `npx vitest run tests/db/migrate.test.ts`
Expected: PASS.

- [ ] **Step 7: Provision Neon and run the real migration (manual)**

Add a Neon Postgres database to the Vercel project from the Marketplace, run `vercel env pull .env.local`, then `set -a; source .env.local; set +a; npm run migrate`.
Expected: `applied: 001_init.sql`. Run again: `applied: none`. If `sql.query` fails because the Neon driver returns a different shape, adjust only `getDb()` in `lib/db.ts`.

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "feat: database layer and initial schema"
```

---

### Task 4: Phone, session and dev login

**Files:**
- Create: `lib/phone.ts`, `lib/session.ts`, `lib/users.ts`, `lib/auth.ts`, `app/api/auth/dev-login/route.ts`, `app/login/page.tsx`
- Test: `tests/phone.test.ts`, `tests/session.test.ts`, `tests/users.test.ts`

**Interfaces:**
- Produces: `normalizePhone(input: string): string | null`; `signSession(userId: string): Promise<string>`; `verifySession(token: string): Promise<string | null>`; `upsertUserByPhone(db: Db, phone: string, name?: string | null): Promise<User>`; `getSessionUser(): Promise<User | null>`; `type User = { id: string; phone: string; name: string | null }`; cookie name `mtk_session`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/phone.test.ts
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
```

```ts
// tests/session.test.ts
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
```

```ts
// tests/users.test.ts
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
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run tests/phone.test.ts tests/session.test.ts tests/users.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement**

```ts
// lib/phone.ts
export function normalizePhone(input: string): string | null {
  let d = input.replace(/[^\d]/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  if (d.length === 10 && /^[6-9]/.test(d)) d = "91" + d;
  else if (d.length === 11 && d.startsWith("0") && /^[6-9]/.test(d[1])) d = "91" + d.slice(1);
  return /^91[6-9]\d{9}$/.test(d) ? "+" + d : null;
}
```

```ts
// lib/session.ts
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
```

```ts
// lib/users.ts
import type { Db } from "@/lib/db";
export type User = { id: string; phone: string; name: string | null };
export async function upsertUserByPhone(db: Db, phone: string, name?: string | null): Promise<User> {
  const rows = await db.query<User>(
    `insert into users (phone, name) values ($1, $2)
     on conflict (phone) do update set name = coalesce(users.name, excluded.name)
     returning id, phone, name`,
    [phone, name ?? null],
  );
  return rows[0];
}
export async function getUserById(db: Db, id: string): Promise<User | null> {
  return (await db.query<User>("select id, phone, name from users where id = $1", [id]))[0] ?? null;
}
```

```ts
// lib/auth.ts
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
```

```ts
// app/api/auth/dev-login/route.ts
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
```

```tsx
// app/login/page.tsx
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
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/phone.test.ts tests/session.test.ts tests/users.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: phone normalisation, sessions, dev login"
```

---

### Task 5: Crash-safe chunk store and joiner

**Files:**
- Create: `lib/recorder/chunk-store.ts`, `lib/recorder/join.ts`
- Test: `tests/recorder/chunk-store.test.ts`, `tests/recorder/join.test.ts`

**Interfaces:**
- Produces:
  - `interface ChunkStore { begin(sessionId: string, mimeType: string): Promise<void>; append(sessionId: string, seq: number, data: ArrayBuffer): Promise<void>; read(sessionId: string): Promise<{ mimeType: string; chunks: ArrayBuffer[] } | null>; listUnfinished(): Promise<string[]>; discard(sessionId: string): Promise<void> }`
  - `createChunkStore(dbName?: string): ChunkStore` (IndexedDB)
  - `joinChunks(chunks: ArrayBuffer[], mimeType: string): Blob`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/recorder/join.test.ts
import { describe, it, expect } from "vitest";
import { joinChunks } from "@/lib/recorder/join";
const buf = (...n: number[]) => new Uint8Array(n).buffer;
describe("joinChunks", () => {
  it("concatenates in order and keeps the mime type", async () => {
    const b = joinChunks([buf(1, 2), buf(3), buf(4, 5)], "audio/webm;codecs=opus");
    expect(b.type).toBe("audio/webm;codecs=opus");
    expect(new Uint8Array(await b.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 4, 5]));
  });
  it("returns an empty blob for no chunks", () => {
    expect(joinChunks([], "audio/webm").size).toBe(0);
  });
});
```

```ts
// tests/recorder/chunk-store.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { createChunkStore } from "@/lib/recorder/chunk-store";
const buf = (...n: number[]) => new Uint8Array(n).buffer;
let n = 0;
describe("chunk store", () => {
  let store: ReturnType<typeof createChunkStore>;
  beforeEach(() => { store = createChunkStore(`test-${n++}`); });

  it("returns chunks in sequence order even if written out of order", async () => {
    await store.begin("s1", "audio/webm");
    await store.append("s1", 1, buf(2));
    await store.append("s1", 0, buf(1));
    await store.append("s1", 2, buf(3));
    const r = await store.read("s1");
    expect(r?.mimeType).toBe("audio/webm");
    expect(r?.chunks.map((c) => new Uint8Array(c)[0])).toEqual([1, 2, 3]);
  });
  it("lists unfinished sessions until discarded", async () => {
    await store.begin("a", "audio/webm");
    await store.begin("b", "audio/webm");
    expect((await store.listUnfinished()).sort()).toEqual(["a", "b"]);
    await store.discard("a");
    expect(await store.listUnfinished()).toEqual(["b"]);
    expect(await store.read("a")).toBeNull();
  });
  it("discard removes the chunks too", async () => {
    await store.begin("a", "audio/webm");
    await store.append("a", 0, buf(9));
    await store.discard("a");
    await store.begin("a", "audio/webm");
    expect((await store.read("a"))?.chunks).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run tests/recorder`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement**

```ts
// lib/recorder/join.ts
export function joinChunks(chunks: ArrayBuffer[], mimeType: string): Blob {
  return new Blob(chunks, { type: mimeType });
}
```

```ts
// lib/recorder/chunk-store.ts
import { openDB } from "idb";

export interface ChunkStore {
  begin(sessionId: string, mimeType: string): Promise<void>;
  append(sessionId: string, seq: number, data: ArrayBuffer): Promise<void>;
  read(sessionId: string): Promise<{ mimeType: string; chunks: ArrayBuffer[] } | null>;
  listUnfinished(): Promise<string[]>;
  discard(sessionId: string): Promise<void>;
}

export function createChunkStore(dbName = "mtk-recordings"): ChunkStore {
  const db = openDB(dbName, 1, {
    upgrade(d) {
      d.createObjectStore("sessions", { keyPath: "id" });
      d.createObjectStore("chunks", { keyPath: ["sessionId", "seq"] });
    },
  });
  return {
    async begin(id, mimeType) {
      const d = await db;
      await d.put("sessions", { id, mimeType, startedAt: Date.now() });
      await d.delete("chunks", IDBKeyRange.bound([id, -Infinity], [id, Infinity]));
    },
    async append(sessionId, seq, data) {
      await (await db).put("chunks", { sessionId, seq, data });
    },
    async read(id) {
      const d = await db;
      const s = await d.get("sessions", id);
      if (!s) return null;
      const rows = await d.getAll("chunks", IDBKeyRange.bound([id, -Infinity], [id, Infinity]));
      rows.sort((a, b) => a.seq - b.seq);
      return { mimeType: s.mimeType, chunks: rows.map((r) => r.data as ArrayBuffer) };
    },
    async listUnfinished() {
      return (await (await db).getAllKeys("sessions")) as string[];
    },
    async discard(id) {
      const d = await db;
      await d.delete("sessions", id);
      await d.delete("chunks", IDBKeyRange.bound([id, -Infinity], [id, Infinity]));
    },
  };
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/recorder`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: crash-safe recording chunk store"
```

---

### Task 6: Recorder, upload and recovery

**Files:**
- Create: `lib/recorder/pending.ts`, `lib/recorder/use-recorder.ts`, `lib/upload-recording.ts`, `app/api/recordings/upload/route.ts`, `components/recorder.tsx`, `components/pending-uploads.tsx`, `app/record/page.tsx`
- Test: `tests/recorder/pending.test.ts`

**Interfaces:**
- Consumes: `ChunkStore`, `joinChunks` (Task 5); `getSessionUser` (Task 4).
- Produces:
  - `MIN_SECONDS = 2`
  - `finishRecording(store: ChunkStore, sessionId: string, durationSec: number, uploader: Uploader): Promise<FinishResult>` where `type Uploader = (blob: Blob, durationSec: number) => Promise<{ recipeId: string }>` and `type FinishResult = { ok: true; recipeId: string } | { ok: false; reason: "too_short" | "empty" | "upload_failed" }`. The local copy is deleted only when `ok: true` or `too_short`/`empty` (nothing worth keeping).
  - `uploadPending(store, uploader, durations?): Promise<number>` re-uploads unfinished sessions, returns the count that succeeded.
  - `uploadRecording(blob: Blob, durationSec: number): Promise<{ recipeId: string }>` (client).

- [ ] **Step 1: Write the failing tests**

```ts
// tests/recorder/pending.test.ts
import { describe, it, expect, vi } from "vitest";
import { createChunkStore } from "@/lib/recorder/chunk-store";
import { finishRecording, uploadPending } from "@/lib/recorder/pending";
const buf = (...n: number[]) => new Uint8Array(n).buffer;
let n = 0;
const fresh = () => createChunkStore(`pending-${n++}`);

describe("finishRecording", () => {
  it("rejects a too-short recording and discards it without uploading", async () => {
    const store = fresh(); const up = vi.fn();
    await store.begin("s", "audio/webm"); await store.append("s", 0, buf(1));
    expect(await finishRecording(store, "s", 1, up)).toEqual({ ok: false, reason: "too_short" });
    expect(up).not.toHaveBeenCalled();
    expect(await store.read("s")).toBeNull();
  });
  it("rejects zero bytes", async () => {
    const store = fresh(); const up = vi.fn();
    await store.begin("s", "audio/webm");
    expect(await finishRecording(store, "s", 30, up)).toEqual({ ok: false, reason: "empty" });
    expect(up).not.toHaveBeenCalled();
  });
  it("keeps the local copy when upload fails, deletes it when it succeeds", async () => {
    const store = fresh();
    await store.begin("s", "audio/webm"); await store.append("s", 0, buf(1, 2, 3));
    const failing = vi.fn().mockRejectedValue(new Error("offline"));
    expect(await finishRecording(store, "s", 30, failing)).toEqual({ ok: false, reason: "upload_failed" });
    expect(await store.read("s")).not.toBeNull();
    const ok = vi.fn().mockResolvedValue({ recipeId: "r1" });
    expect(await finishRecording(store, "s", 30, ok)).toEqual({ ok: true, recipeId: "r1" });
    expect(await store.read("s")).toBeNull();
  });
});

describe("uploadPending", () => {
  it("re-uploads unfinished sessions and reports how many succeeded", async () => {
    const store = fresh();
    for (const id of ["a", "b"]) { await store.begin(id, "audio/webm"); await store.append(id, 0, buf(1, 2)); }
    const up = vi.fn().mockResolvedValueOnce({ recipeId: "r1" }).mockRejectedValueOnce(new Error("x"));
    expect(await uploadPending(store, up)).toBe(1);
    expect((await store.listUnfinished()).length).toBe(1);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run tests/recorder/pending.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `pending.ts`**

```ts
// lib/recorder/pending.ts
import type { ChunkStore } from "@/lib/recorder/chunk-store";
import { joinChunks } from "@/lib/recorder/join";

export const MIN_SECONDS = 2;
export type Uploader = (blob: Blob, durationSec: number) => Promise<{ recipeId: string }>;
export type FinishResult = { ok: true; recipeId: string } | { ok: false; reason: "too_short" | "empty" | "upload_failed" };

export async function finishRecording(store: ChunkStore, sessionId: string, durationSec: number, upload: Uploader): Promise<FinishResult> {
  const data = await store.read(sessionId);
  const blob = data ? joinChunks(data.chunks, data.mimeType) : null;
  if (!blob || blob.size === 0) { await store.discard(sessionId); return { ok: false, reason: "empty" }; }
  if (durationSec < MIN_SECONDS) { await store.discard(sessionId); return { ok: false, reason: "too_short" }; }
  try {
    const { recipeId } = await upload(blob, durationSec);
    await store.discard(sessionId);
    return { ok: true, recipeId };
  } catch {
    return { ok: false, reason: "upload_failed" };
  }
}

// Duration of a recovered session is unknown, so assume it passed the minimum.
export async function uploadPending(store: ChunkStore, upload: Uploader): Promise<number> {
  let ok = 0;
  for (const id of await store.listUnfinished()) {
    const r = await finishRecording(store, id, MIN_SECONDS, upload);
    if (r.ok) ok++;
  }
  return ok;
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/recorder/pending.test.ts`
Expected: PASS.

- [ ] **Step 5: Upload route and client uploader**

```ts
// app/api/recordings/upload/route.ts
import { NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { getSessionUser } from "@/lib/auth";

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });
  const body = (await request.json()) as HandleUploadBody;
  try {
    const json = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname) => {
        if (!pathname.startsWith("recordings/")) throw new Error("Invalid path");
        return { allowedContentTypes: ["audio/*"], maximumSizeInBytes: 300 * 1024 * 1024, addRandomSuffix: false };
      },
      onUploadCompleted: async () => {},
    });
    return NextResponse.json(json);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
```

```ts
// lib/upload-recording.ts
"use client";
import { upload } from "@vercel/blob/client";

function extensionFor(type: string) {
  if (type.includes("mp4")) return "m4a";
  if (type.includes("ogg")) return "ogg";
  return "webm";
}

export async function uploadRecording(blob: Blob, durationSec: number): Promise<{ recipeId: string }> {
  const pathname = `recordings/${crypto.randomUUID()}.${extensionFor(blob.type)}`;
  const stored = await upload(pathname, blob, { access: "private", handleUploadUrl: "/api/recordings/upload", multipart: true });
  const res = await fetch("/api/recipes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ audioPathname: stored.pathname, durationSec }) });
  if (!res.ok) throw new Error("Could not save the recipe");
  return (await res.json()) as { recipeId: string };
}
```

- [ ] **Step 6: Recorder hook**

```ts
// lib/recorder/use-recorder.ts
"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { createChunkStore, type ChunkStore } from "@/lib/recorder/chunk-store";

export type RecorderState = "idle" | "recording" | "paused" | "stopped" | "error";

function pickMime(): string {
  for (const t of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"]) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t)) return t;
  }
  return "";
}

export function useRecorder() {
  const [state, setState] = useState<RecorderState>("idle");
  const [seconds, setSeconds] = useState(0);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const storeRef = useRef<ChunkStore | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const sessionRef = useRef<string>("");
  const wakeRef = useRef<WakeLockSentinel | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const secondsRef = useRef(0);

  const store = () => (storeRef.current ??= createChunkStore());

  const start = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = pickMime();
      const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      const id = crypto.randomUUID();
      sessionRef.current = id;
      await store().begin(id, rec.mimeType || mimeType || "audio/webm");
      let seq = 0;
      rec.ondataavailable = async (e) => {
        if (e.data.size > 0) await store().append(id, seq++, await e.data.arrayBuffer());
      };
      rec.start(5000);
      recRef.current = rec;
      try { wakeRef.current = await navigator.wakeLock?.request("screen"); } catch {}
      const ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      ctx.createMediaStreamSource(stream).connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      audioCtxRef.current = ctx;
      secondsRef.current = 0; setSeconds(0);
      tickRef.current = setInterval(() => {
        analyser.getByteTimeDomainData(data);
        setLevel(Math.max(...data) / 255 - 0.5);
        if (rec.state === "recording") { secondsRef.current += 0.25; setSeconds(Math.floor(secondsRef.current)); }
      }, 250);
      setState("recording");
    } catch {
      setError("We could not use the microphone. Please allow microphone access and try again.");
      setState("error");
    }
  }, []);

  const pause = useCallback(() => { recRef.current?.pause(); setState("paused"); }, []);
  const resume = useCallback(() => { recRef.current?.resume(); setState("recording"); }, []);

  const stop = useCallback(async () => {
    const rec = recRef.current;
    if (!rec) return null;
    await new Promise<void>((resolve) => { rec.addEventListener("stop", () => resolve(), { once: true }); rec.stop(); });
    // Give the last ondataavailable write a moment to land in IndexedDB.
    await new Promise((r) => setTimeout(r, 150));
    rec.stream.getTracks().forEach((t) => t.stop());
    if (tickRef.current) clearInterval(tickRef.current);
    await audioCtxRef.current?.close();
    await wakeRef.current?.release().catch(() => {});
    setState("stopped");
    return { sessionId: sessionRef.current, durationSec: Math.round(secondsRef.current) };
  }, []);

  useEffect(() => () => { if (tickRef.current) clearInterval(tickRef.current); }, []);

  return { state, seconds, level, error, start, pause, resume, stop, store };
}
```

- [ ] **Step 7: UI**

```tsx
// components/recorder.tsx
"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useRecorder } from "@/lib/recorder/use-recorder";
import { finishRecording } from "@/lib/recorder/pending";
import { uploadRecording } from "@/lib/upload-recording";

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

export function Recorder() {
  const r = useRecorder();
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function onStop() {
    setBusy(true);
    const done = await r.stop();
    if (!done) { setBusy(false); return; }
    const res = await finishRecording(r.store(), done.sessionId, done.durationSec, uploadRecording);
    if (res.ok) { router.push("/"); return; }
    setBusy(false);
    if (res.reason === "upload_failed") setMessage("Saved on this phone. It will upload when you are back online.");
    else setMessage("That was too short, try again.");
  }

  return (
    <div className="flex flex-col items-center gap-6 p-6">
      <div className="text-5xl font-mono tabular-nums">{fmt(r.seconds)}</div>
      <div className="h-2 w-48 overflow-hidden rounded bg-neutral-200"><div className="h-full bg-red-500 transition-all" style={{ width: `${Math.min(100, Math.max(0, r.level * 300))}%` }} /></div>
      {r.state === "idle" && <button onClick={r.start} className="h-24 w-24 rounded-full bg-red-600 text-white shadow-lg" aria-label="Start recording">Record</button>}
      {r.state === "recording" && (
        <div className="flex gap-4">
          <button onClick={r.pause} className="rounded border px-6 py-3">Pause</button>
          <button onClick={onStop} disabled={busy} className="rounded bg-black px-6 py-3 text-white">Stop</button>
        </div>
      )}
      {r.state === "paused" && (
        <div className="flex gap-4">
          <button onClick={r.resume} className="rounded border px-6 py-3">Resume</button>
          <button onClick={onStop} disabled={busy} className="rounded bg-black px-6 py-3 text-white">Stop</button>
        </div>
      )}
      {r.state === "recording" && <p className="text-sm text-neutral-600">Recording. Keep this screen open.</p>}
      {r.error && <p className="text-sm text-red-600">{r.error}</p>}
      {message && <p className="text-sm">{message}</p>}
    </div>
  );
}
```

```tsx
// components/pending-uploads.tsx
"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createChunkStore } from "@/lib/recorder/chunk-store";
import { uploadPending } from "@/lib/recorder/pending";
import { uploadRecording } from "@/lib/upload-recording";

export function PendingUploads() {
  const router = useRouter();
  const [count, setCount] = useState(0);
  const [busy, setBusy] = useState(false);
  useEffect(() => { createChunkStore().listUnfinished().then((l) => setCount(l.length)).catch(() => {}); }, []);
  if (count === 0) return null;
  return (
    <div className="rounded border border-amber-300 bg-amber-50 p-4 text-sm">
      <p>{count} recording{count > 1 ? "s" : ""} saved on this phone and not uploaded yet.</p>
      <button disabled={busy} className="mt-2 rounded bg-black px-4 py-2 text-white" onClick={async () => {
        setBusy(true);
        await uploadPending(createChunkStore(), uploadRecording);
        setCount((await createChunkStore().listUnfinished()).length);
        setBusy(false);
        router.refresh();
      }}>Upload now</button>
    </div>
  );
}
```

```tsx
// app/record/page.tsx
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { Recorder } from "@/components/recorder";
export default async function RecordPage() {
  if (!(await getSessionUser())) redirect("/login");
  return <main className="mx-auto max-w-md"><h1 className="p-6 pb-0 text-2xl font-semibold">Tell us the recipe</h1><Recorder /></main>;
}
```

- [ ] **Step 8: Typecheck and commit**

Run: `npx tsc --noEmit && npm test`
Expected: no type errors, tests PASS. (The hook and UI are verified on a real phone in Task 12.)

```bash
git add -A && git commit -m "feat: recorder, private upload, recovery of unsent recordings"
```

---

### Task 7: Sarvam provider

**Files:**
- Create: `lib/stt/types.ts`, `lib/stt/sarvam.ts`
- Test: `tests/stt/sarvam.test.ts`

**Interfaces:**
- Produces:
  - `type Segment = { text: string; start: number; end: number }`
  - `type Transcript = { language: string; text: string; segments: Segment[] }`
  - `type SttState = { state: "pending" } | { state: "failed"; error: string } | { state: "done"; transcript: Transcript }`
  - `interface SttProvider { start(audio: { bytes: Uint8Array; filename: string; contentType: string }, opts: { callbackUrl: string; languageHint?: string }): Promise<{ jobId: string }>; fetch(jobId: string): Promise<SttState> }`
  - `parseSarvamOutput(raw: unknown): Transcript`
  - `createSarvamProvider(): SttProvider`

- [ ] **Step 1: Write the failing tests** (fixture shape comes from Sarvam's published output format and is replaced by a real spike output)

```ts
// tests/stt/sarvam.test.ts
import { describe, it, expect } from "vitest";
import { parseSarvamOutput } from "@/lib/stt/sarvam";

describe("parseSarvamOutput", () => {
  it("maps chunks with start and end times", () => {
    const t = parseSarvamOutput({
      transcript: "Pehle pyaaz kaato. Phir tel garam karo.",
      language_code: "hi-IN",
      timestamps: { chunks: ["Pehle pyaaz kaato.", " Phir tel garam karo."], start_time_seconds: [0.01, 2.8], end_time_seconds: [2.5, 4.2] },
    });
    expect(t.language).toBe("hi-IN");
    expect(t.segments).toEqual([
      { text: "Pehle pyaaz kaato.", start: 0.01, end: 2.5 },
      { text: "Phir tel garam karo.", start: 2.8, end: 4.2 },
    ]);
    expect(t.text).toBe("Pehle pyaaz kaato. Phir tel garam karo.");
  });
  it("returns an empty transcript when there is no speech", () => {
    const t = parseSarvamOutput({ transcript: "", language_code: null, timestamps: { chunks: [], start_time_seconds: [], end_time_seconds: [] } });
    expect(t.text).toBe("");
    expect(t.segments).toEqual([]);
    expect(t.language).toBe("unknown");
  });
  it("falls back to one segment when only plain text comes back", () => {
    const t = parseSarvamOutput({ transcript: "Namak daalo", language_code: "hi-IN" });
    expect(t.segments).toEqual([{ text: "Namak daalo", start: 0, end: 0 }]);
  });
  it("drops blank chunks and tolerates missing times", () => {
    const t = parseSarvamOutput({ transcript: "a b", timestamps: { chunks: ["a", "  ", "b"], start_time_seconds: [0, 1], end_time_seconds: [1] } });
    expect(t.segments.map((s) => s.text)).toEqual(["a", "b"]);
    expect(t.segments[1]).toEqual({ text: "b", start: 0, end: 0 });
  });
});
```

(The last case: chunk "b" is at index 2, whose start/end are missing, so both default to 0.)

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run tests/stt/sarvam.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement the types and the pure parser**

```ts
// lib/stt/types.ts
export type Segment = { text: string; start: number; end: number };
export type Transcript = { language: string; text: string; segments: Segment[] };
export type SttState = { state: "pending" } | { state: "failed"; error: string } | { state: "done"; transcript: Transcript };
export interface SttProvider {
  start(audio: { bytes: Uint8Array; filename: string; contentType: string }, opts: { callbackUrl: string; languageHint?: string }): Promise<{ jobId: string }>;
  fetch(jobId: string): Promise<SttState>;
}
```

```ts
// lib/stt/sarvam.ts
import { SarvamAIClient } from "sarvamai";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { requireEnv } from "@/lib/env";
import type { SttProvider, SttState, Transcript } from "@/lib/stt/types";

export function parseSarvamOutput(raw: unknown): Transcript {
  const o = (raw ?? {}) as {
    transcript?: string | null;
    language_code?: string | null;
    timestamps?: { chunks?: string[]; start_time_seconds?: number[]; end_time_seconds?: number[] };
  };
  const chunks = o.timestamps?.chunks ?? [];
  const starts = o.timestamps?.start_time_seconds ?? [];
  const ends = o.timestamps?.end_time_seconds ?? [];
  let segments = chunks
    .map((text, i) => ({ text: text.trim(), start: starts[i] ?? 0, end: ends[i] ?? 0 }))
    .filter((s) => s.text.length > 0);
  const text = (o.transcript ?? segments.map((s) => s.text).join(" ")).trim();
  if (segments.length === 0 && text) segments = [{ text, start: 0, end: 0 }];
  return { language: o.language_code ?? "unknown", text, segments };
}

// The SDK calls below must match the working sequence recorded in docs/spike/sarvam-findings.md.
export function createSarvamProvider(): SttProvider {
  const client = () => new SarvamAIClient({ apiSubscriptionKey: requireEnv("SARVAM_API_KEY") });
  return {
    async start(audio, opts) {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mtk-"));
      const file = path.join(dir, audio.filename);
      await fs.writeFile(file, audio.bytes);
      try {
        const job = await client().speechToTextJob.createJob({
          model: "saaras:v4",
          mode: "transcribe",
          ...(opts.languageHint ? { languageCode: opts.languageHint } : {}),
          callback: { url: opts.callbackUrl, authToken: requireEnv("SARVAM_WEBHOOK_TOKEN") },
        } as never);
        await job.uploadFiles([file]);
        await job.start();
        return { jobId: (job as unknown as { jobId: string }).jobId };
      } finally {
        await fs.rm(dir, { recursive: true, force: true });
      }
    },
    async fetch(jobId): Promise<SttState> {
      const c = client();
      const status = await (c.speechToTextJob as never as { getStatus(id: string): Promise<{ jobState: string; errorMessage?: string; jobDetails?: { outputs?: { fileName: string }[] }[] }> }).getStatus(jobId);
      if (status.jobState === "Failed") return { state: "failed", error: status.errorMessage || "Transcription failed" };
      if (status.jobState !== "Completed") return { state: "pending" };
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mtk-out-"));
      try {
        const job = await (c.speechToTextJob as never as { get(id: string): Promise<{ downloadOutputs(dir: string): Promise<void> }> }).get(jobId);
        await job.downloadOutputs(dir);
        const name = (await fs.readdir(dir)).find((f) => f.endsWith(".json"));
        if (!name) return { state: "failed", error: "No transcript file returned" };
        return { state: "done", transcript: parseSarvamOutput(JSON.parse(await fs.readFile(path.join(dir, name), "utf8"))) };
      } finally {
        await fs.rm(dir, { recursive: true, force: true });
      }
    },
  };
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/stt/sarvam.test.ts`
Expected: PASS.

- [ ] **Step 5: Verify the provider against real Sarvam (needs the spike results)**

Open `docs/spike/sarvam-findings.md` and compare each SDK call in `createSarvamProvider` (`createJob`, `uploadFiles`, `start`, job id property, `getStatus`, `get`, `downloadOutputs`, `callback`) with the working sequence. Edit any name that differs. Then run a real check:

```bash
cat > /tmp/provider-check.ts <<'EOF'
import fs from "node:fs";
import { createSarvamProvider } from "@/lib/stt/sarvam";
const p = createSarvamProvider();
const { jobId } = await p.start({ bytes: fs.readFileSync(process.argv[2]), filename: "a.webm", contentType: "audio/webm" }, { callbackUrl: process.env.APP_BASE_URL + "/api/sarvam/webhook" });
console.log("job", jobId);
for (let i = 0; i < 60; i++) { const s = await p.fetch(jobId); console.log(s.state); if (s.state !== "pending") { console.log(JSON.stringify(s).slice(0, 600)); break; } await new Promise((r) => setTimeout(r, 5000)); }
EOF
set -a; source .env.local; set +a; npx tsx --tsconfig tsconfig.json /tmp/provider-check.ts spike-audio/hindi-1.webm
```

Expected: `job <id>`, then `pending` several times, then `done` with segments.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: Sarvam STT provider and output parser"
```

---

### Task 8: LLM client and recipe structuring

**Files:**
- Create: `lib/llm.ts`, `lib/structure.ts`
- Test: `tests/structure.test.ts`

**Interfaces:**
- Produces:
  - `interface LlmClient { complete(system: string, user: string): Promise<string> }`
  - `gatewayLlm(): LlmClient`
  - `type StructuredRecipe = { title: string; ingredients: { name: string; quantity?: string }[]; steps: string[] }`
  - `structureRecipe(transcriptText: string, llm: LlmClient): Promise<StructuredRecipe>` throws `StructureError` after one retry if the output is not valid.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/structure.test.ts
import { describe, it, expect, vi } from "vitest";
import { structureRecipe, StructureError } from "@/lib/structure";

const good = JSON.stringify({ title: "आलू गोभी", ingredients: [{ name: "आलू", quantity: "2" }, { name: "नमक" }], steps: ["आलू काटो", "तेल गरम करो"] });

describe("structureRecipe", () => {
  it("parses plain JSON and keeps the original language", async () => {
    const llm = { complete: vi.fn().mockResolvedValue(good) };
    const r = await structureRecipe("आलू गोभी बनाने के लिए...", llm);
    expect(r.title).toBe("आलू गोभी");
    expect(r.ingredients[1]).toEqual({ name: "नमक" });
    const [system] = llm.complete.mock.calls[0];
    expect(system).toMatch(/same language/i);
    expect(system).toMatch(/do not translate/i);
  });
  it("accepts JSON wrapped in a code fence", async () => {
    const llm = { complete: vi.fn().mockResolvedValue("```json\n" + good + "\n```") };
    expect((await structureRecipe("x", llm)).steps.length).toBe(2);
  });
  it("retries once on invalid output, then succeeds", async () => {
    const llm = { complete: vi.fn().mockResolvedValueOnce("not json").mockResolvedValueOnce(good) };
    expect((await structureRecipe("x", llm)).title).toBe("आलू गोभी");
    expect(llm.complete).toHaveBeenCalledTimes(2);
  });
  it("throws StructureError after the retry also fails", async () => {
    const llm = { complete: vi.fn().mockResolvedValue("{\"title\": 5}") };
    await expect(structureRecipe("x", llm)).rejects.toBeInstanceOf(StructureError);
    expect(llm.complete).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run tests/structure.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
// lib/llm.ts
import { requireEnv } from "@/lib/env";
export interface LlmClient { complete(system: string, user: string): Promise<string> }

export function gatewayLlm(): LlmClient {
  return {
    async complete(system, user) {
      const res = await fetch("https://ai-gateway.vercel.sh/v1/chat/completions", {
        method: "POST",
        headers: { authorization: `Bearer ${requireEnv("AI_GATEWAY_API_KEY")}`, "content-type": "application/json" },
        body: JSON.stringify({ model: requireEnv("STRUCTURE_MODEL"), temperature: 0, messages: [{ role: "system", content: system }, { role: "user", content: user }] }),
      });
      if (!res.ok) throw new Error(`LLM request failed: ${res.status}`);
      const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      const content = json.choices?.[0]?.message?.content;
      if (!content) throw new Error("LLM returned no content");
      return content;
    },
  };
}
```

```ts
// lib/structure.ts
import { z } from "zod";
import type { LlmClient } from "@/lib/llm";

export class StructureError extends Error {}

const schema = z.object({
  title: z.string().min(1),
  ingredients: z.array(z.object({ name: z.string().min(1), quantity: z.string().min(1).optional() })),
  steps: z.array(z.string().min(1)),
});
export type StructuredRecipe = z.infer<typeof schema>;

const SYSTEM = [
  "You turn a spoken recipe transcript into structured JSON.",
  "Write every field in the same language and script as the transcript. Do not translate.",
  "Use only what the speaker said. Do not invent ingredients, quantities or steps.",
  "Keep spoken quantities as the speaker said them (for example 'ek chammach', 'andaaz se').",
  'Reply with JSON only, shaped as {"title": string, "ingredients": [{"name": string, "quantity"?: string}], "steps": [string]}.',
].join("\n");

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  return JSON.parse((fenced ? fenced[1] : text).trim());
}

export async function structureRecipe(transcriptText: string, llm: LlmClient): Promise<StructuredRecipe> {
  let lastError = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const hint = attempt === 0 ? "" : `\n\nYour previous reply was invalid (${lastError}). Reply with valid JSON only.`;
    try {
      const out = await llm.complete(SYSTEM, `Transcript:\n${transcriptText}${hint}`);
      return schema.parse(extractJson(out));
    } catch (e) {
      lastError = (e as Error).message.slice(0, 200);
    }
  }
  throw new StructureError(lastError);
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/structure.test.ts`
Expected: PASS.

- [ ] **Step 5: Check the gateway call for real**

```bash
cat > /tmp/structure-check.ts <<'EOF'
import { gatewayLlm } from "@/lib/llm";
import { structureRecipe } from "@/lib/structure";
console.log(JSON.stringify(await structureRecipe("Pehle do aloo kaat lo, phir kadhai mein tel garam karo, jeera daalo, andaaz se namak daalo.", gatewayLlm()), null, 2));
EOF
set -a; source .env.local; set +a; npx tsx --tsconfig tsconfig.json /tmp/structure-check.ts
```

Expected: JSON with a title, ingredients (including "andaaz se" for salt) and steps, in Roman Hindi.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: LLM structuring of transcripts"
```

---

### Task 9: Recipes repository and pipeline

**Files:**
- Create: `lib/recipes.ts`, `lib/pipeline.ts`
- Test: `tests/pipeline.test.ts`

**Interfaces:**
- Consumes: `Db`, `SttProvider`, `Transcript`, `LlmClient`, `structureRecipe`.
- Produces (`lib/recipes.ts`): `type Recipe = { id; owner_id; title: string | null; status: "uploaded"|"transcribing"|"structuring"|"ready"|"failed"; note: string | null; error: string | null; language: string | null; audio_pathname: string; duration_sec: number; stt_job_id: string | null; transcript_text: string | null; ingredients: {name:string;quantity?:string}[] | null; steps: string[] | null; created_at: string }`; `createRecipe(db, ownerId, audioPathname, durationSec): Promise<Recipe>`; `getRecipeForOwner(db, id, ownerId): Promise<Recipe | null>`; `listRecipes(db, ownerId): Promise<Recipe[]>`; `getRecipeById`, `getRecipeByJobId`; `listSegments(db, recipeId)`.
- Produces (`lib/pipeline.ts`): `type PipelineDeps = { db: Db; stt: SttProvider; llm: LlmClient; readAudio(pathname: string): Promise<{ bytes: Uint8Array; filename: string; contentType: string }>; callbackUrl: string }`; `startTranscription(deps, recipeId): Promise<void>`; `completeTranscription(deps, jobId): Promise<"pending"|"ready"|"failed"|"ignored">`; `retryRecipe(deps, recipeId, ownerId): Promise<boolean>`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/pipeline.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeTestDb } from "@/tests/helpers/test-db";
import { upsertUserByPhone } from "@/lib/users";
import { createRecipe, getRecipeById, listSegments } from "@/lib/recipes";
import { startTranscription, completeTranscription, retryRecipe, type PipelineDeps } from "@/lib/pipeline";
import type { SttState } from "@/lib/stt/types";

const structured = JSON.stringify({ title: "Aloo Gobi", ingredients: [{ name: "aloo" }], steps: ["kaato"] });
const doneState: SttState = { state: "done", transcript: { language: "hi-IN", text: "aloo kaato", segments: [{ text: "aloo kaato", start: 0, end: 2 }] } };

async function setup(sttFetch: () => Promise<SttState>, llmOut: string | (() => Promise<string>) = structured) {
  const db = await makeTestDb();
  const user = await upsertUserByPhone(db, "+919876543210", "Asha");
  const recipe = await createRecipe(db, user.id, "recordings/x.webm", 90);
  const deps: PipelineDeps = {
    db,
    stt: { start: vi.fn().mockResolvedValue({ jobId: "job-1" }), fetch: vi.fn(sttFetch) },
    llm: { complete: vi.fn(typeof llmOut === "string" ? async () => llmOut : llmOut) },
    readAudio: vi.fn().mockResolvedValue({ bytes: new Uint8Array([1]), filename: "x.webm", contentType: "audio/webm" }),
    callbackUrl: "https://app.test/api/sarvam/webhook",
  };
  return { db, user, recipe, deps };
}

describe("pipeline", () => {
  it("runs uploaded -> transcribing -> ready with segments and a structured recipe", async () => {
    const { db, recipe, deps } = await setup(async () => doneState);
    await startTranscription(deps, recipe.id);
    expect((await getRecipeById(db, recipe.id))?.status).toBe("transcribing");
    expect(await completeTranscription(deps, "job-1")).toBe("ready");
    const r = (await getRecipeById(db, recipe.id))!;
    expect(r.status).toBe("ready");
    expect(r.title).toBe("Aloo Gobi");
    expect(r.language).toBe("hi-IN");
    expect((await listSegments(db, recipe.id)).map((s) => s.text)).toEqual(["aloo kaato"]);
  });

  it("stays pending while the STT job is still running", async () => {
    const { db, recipe, deps } = await setup(async () => ({ state: "pending" }));
    await startTranscription(deps, recipe.id);
    expect(await completeTranscription(deps, "job-1")).toBe("pending");
    expect((await getRecipeById(db, recipe.id))?.status).toBe("transcribing");
  });

  it("marks failed when STT fails, and retry restarts it", async () => {
    let fail = true;
    const { db, user, recipe, deps } = await setup(async () => (fail ? { state: "failed", error: "bad audio" } : doneState));
    await startTranscription(deps, recipe.id);
    expect(await completeTranscription(deps, "job-1")).toBe("failed");
    expect((await getRecipeById(db, recipe.id))?.status).toBe("failed");
    fail = false;
    expect(await retryRecipe(deps, recipe.id, user.id)).toBe(true);
    expect((await getRecipeById(db, recipe.id))?.status).toBe("transcribing");
  });

  it("marks failed when starting the STT job throws", async () => {
    const { db, recipe, deps } = await setup(async () => doneState);
    (deps.stt.start as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("network"));
    await startTranscription(deps, recipe.id);
    const r = (await getRecipeById(db, recipe.id))!;
    expect(r.status).toBe("failed");
    expect(r.error).toMatch(/network/);
  });

  it("[review focus 2] silent audio reaches ready with a note and never calls the LLM", async () => {
    const { db, recipe, deps } = await setup(async () => ({ state: "done", transcript: { language: "unknown", text: "", segments: [] } }));
    await startTranscription(deps, recipe.id);
    expect(await completeTranscription(deps, "job-1")).toBe("ready");
    const r = (await getRecipeById(db, recipe.id))!;
    expect(r.status).toBe("ready");
    expect(r.note).toBe("no_speech");
    expect(deps.llm.complete).not.toHaveBeenCalled();
  });

  it("falls back to the raw transcript when structuring fails", async () => {
    const { db, recipe, deps } = await setup(async () => doneState, "garbage");
    await startTranscription(deps, recipe.id);
    expect(await completeTranscription(deps, "job-1")).toBe("ready");
    const r = (await getRecipeById(db, recipe.id))!;
    expect(r.status).toBe("ready");
    expect(r.title).toBeNull();
    expect(r.transcript_text).toBe("aloo kaato");
    expect(r.note).toBe("structure_failed");
  });

  it("[review focus 3] duplicate completion calls do one transcript and one LLM call", async () => {
    const { db, recipe, deps } = await setup(async () => doneState);
    await startTranscription(deps, recipe.id);
    const results = await Promise.all([completeTranscription(deps, "job-1"), completeTranscription(deps, "job-1")]);
    expect(results.sort()).toEqual(["ignored", "ready"]);
    expect(deps.llm.complete).toHaveBeenCalledTimes(1);
    expect((await listSegments(db, recipe.id)).length).toBe(1);
  });

  it("ignores an unknown job id", async () => {
    const { deps } = await setup(async () => doneState);
    expect(await completeTranscription(deps, "nope")).toBe("ignored");
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run tests/pipeline.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement the repository**

```ts
// lib/recipes.ts
import type { Db } from "@/lib/db";

export type RecipeStatus = "uploaded" | "transcribing" | "structuring" | "ready" | "failed";
export type Recipe = {
  id: string; owner_id: string; title: string | null; status: RecipeStatus; note: string | null; error: string | null;
  language: string | null; audio_pathname: string; duration_sec: number; stt_job_id: string | null; transcript_text: string | null;
  ingredients: { name: string; quantity?: string }[] | null; steps: string[] | null; created_at: string;
};
export type SegmentRow = { recipe_id: string; idx: number; text: string; edited_text: string | null; start_sec: number; end_sec: number };

const COLS = "id, owner_id, title, status, note, error, language, audio_pathname, duration_sec, stt_job_id, transcript_text, ingredients, steps, created_at";

export async function createRecipe(db: Db, ownerId: string, audioPathname: string, durationSec: number): Promise<Recipe> {
  return (await db.query<Recipe>(`insert into recipes (owner_id, status, audio_pathname, duration_sec) values ($1, 'uploaded', $2, $3) returning ${COLS}`, [ownerId, audioPathname, durationSec]))[0];
}
export async function getRecipeById(db: Db, id: string): Promise<Recipe | null> {
  return (await db.query<Recipe>(`select ${COLS} from recipes where id = $1`, [id]))[0] ?? null;
}
export async function getRecipeForOwner(db: Db, id: string, ownerId: string): Promise<Recipe | null> {
  return (await db.query<Recipe>(`select ${COLS} from recipes where id = $1 and owner_id = $2`, [id, ownerId]))[0] ?? null;
}
export async function getRecipeByJobId(db: Db, jobId: string): Promise<Recipe | null> {
  return (await db.query<Recipe>(`select ${COLS} from recipes where stt_job_id = $1`, [jobId]))[0] ?? null;
}
export async function listRecipes(db: Db, ownerId: string): Promise<Recipe[]> {
  return db.query<Recipe>(`select ${COLS} from recipes where owner_id = $1 order by created_at desc limit 200`, [ownerId]);
}
export async function listSegments(db: Db, recipeId: string): Promise<SegmentRow[]> {
  return db.query<SegmentRow>("select recipe_id, idx, text, edited_text, start_sec, end_sec from segments where recipe_id = $1 order by idx", [recipeId]);
}
export async function listStuck(db: Db, olderThanMinutes: number): Promise<{ stt_job_id: string }[]> {
  return db.query<{ stt_job_id: string }>("select stt_job_id from recipes where status = 'transcribing' and updated_at < now() - ($1 || ' minutes')::interval", [String(olderThanMinutes)]);
}
```

- [ ] **Step 4: Implement the pipeline**

```ts
// lib/pipeline.ts
import type { Db } from "@/lib/db";
import type { LlmClient } from "@/lib/llm";
import { getRecipeByJobId, getRecipeById, getRecipeForOwner } from "@/lib/recipes";
import { structureRecipe } from "@/lib/structure";
import type { SttProvider } from "@/lib/stt/types";

export type PipelineDeps = {
  db: Db;
  stt: SttProvider;
  llm: LlmClient;
  readAudio(pathname: string): Promise<{ bytes: Uint8Array; filename: string; contentType: string }>;
  callbackUrl: string;
};

export async function startTranscription(deps: PipelineDeps, recipeId: string): Promise<void> {
  const { db } = deps;
  const claimed = await db.query("update recipes set status = 'transcribing', error = null, updated_at = now() where id = $1 and status in ('uploaded','failed') returning id", [recipeId]);
  if (claimed.length === 0) return;
  const recipe = await getRecipeById(db, recipeId);
  try {
    const audio = await deps.readAudio(recipe!.audio_pathname);
    const { jobId } = await deps.stt.start(audio, { callbackUrl: deps.callbackUrl });
    await db.query("update recipes set stt_job_id = $2, updated_at = now() where id = $1", [recipeId, jobId]);
  } catch (e) {
    await db.query("update recipes set status = 'failed', error = $2, updated_at = now() where id = $1", [recipeId, (e as Error).message.slice(0, 300)]);
  }
}

export async function completeTranscription(deps: PipelineDeps, jobId: string): Promise<"pending" | "ready" | "failed" | "ignored"> {
  const { db } = deps;
  const recipe = await getRecipeByJobId(db, jobId);
  if (!recipe || recipe.status !== "transcribing") return "ignored";
  const state = await deps.stt.fetch(jobId);
  if (state.state === "pending") return "pending";
  if (state.state === "failed") {
    await db.query("update recipes set status = 'failed', error = $2, updated_at = now() where id = $1 and status = 'transcribing'", [recipe.id, state.error.slice(0, 300)]);
    return "failed";
  }
  // Atomic claim: only one caller moves transcribing -> structuring.
  const claimed = await db.query("update recipes set status = 'structuring', updated_at = now() where id = $1 and status = 'transcribing' returning id", [recipe.id]);
  if (claimed.length === 0) return "ignored";

  const { transcript } = state;
  for (const [i, s] of transcript.segments.entries()) {
    await db.query("insert into segments (recipe_id, idx, text, start_sec, end_sec) values ($1, $2, $3, $4, $5) on conflict do nothing", [recipe.id, i, s.text, s.start, s.end]);
  }
  if (!transcript.text) {
    await db.query("update recipes set status = 'ready', note = 'no_speech', language = $2, transcript_text = '', updated_at = now() where id = $1", [recipe.id, transcript.language]);
    return "ready";
  }
  try {
    const r = await structureRecipe(transcript.text, deps.llm);
    await db.query(
      "update recipes set status = 'ready', title = $2, ingredients = $3::jsonb, steps = $4::jsonb, language = $5, transcript_text = $6, updated_at = now() where id = $1",
      [recipe.id, r.title, JSON.stringify(r.ingredients), JSON.stringify(r.steps), transcript.language, transcript.text],
    );
  } catch {
    await db.query("update recipes set status = 'ready', note = 'structure_failed', language = $2, transcript_text = $3, updated_at = now() where id = $1", [recipe.id, transcript.language, transcript.text]);
  }
  return "ready";
}

export async function retryRecipe(deps: PipelineDeps, recipeId: string, ownerId: string): Promise<boolean> {
  const recipe = await getRecipeForOwner(deps.db, recipeId, ownerId);
  if (!recipe || recipe.status !== "failed") return false;
  await startTranscription(deps, recipeId);
  return true;
}
```

- [ ] **Step 5: Run tests**

Run: `npx vitest run tests/pipeline.test.ts`
Expected: PASS (8 tests). If the duplicate-completion test is flaky under PGlite's single connection, both calls still serialise through the atomic `update ... where status = 'transcribing'`; confirm exactly one returns `"ready"`.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: recipe repository and transcription pipeline"
```

---

### Task 10: API routes

**Files:**
- Create: `lib/deps.ts`, `app/api/recipes/route.ts`, `app/api/recipes/[id]/route.ts`, `app/api/recipes/[id]/retry/route.ts`, `app/api/audio/[id]/route.ts`, `app/api/sarvam/webhook/route.ts`, `app/api/cron/sweep/route.ts`, `vercel.json`
- Test: `tests/webhook-auth.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces: `buildDeps(): PipelineDeps`; `verifyWebhookToken(received: string | null, expected: string): boolean` (timing-safe, in `lib/webhook-auth.ts`).

- [ ] **Step 1: Write the failing test for the token check**

```ts
// tests/webhook-auth.test.ts
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
```

- [ ] **Step 2: Run to confirm failure, then implement**

Run: `npx vitest run tests/webhook-auth.test.ts` (FAIL: module not found)

```ts
// lib/webhook-auth.ts
import { timingSafeEqual } from "node:crypto";
export function verifyWebhookToken(received: string | null, expected: string): boolean {
  if (!received || !expected) return false;
  const a = Buffer.from(received); const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
```

Run again. Expected: PASS.

- [ ] **Step 3: Dependencies factory**

```ts
// lib/deps.ts
import { get } from "@vercel/blob";
import { getDb } from "@/lib/db";
import { gatewayLlm } from "@/lib/llm";
import type { PipelineDeps } from "@/lib/pipeline";
import { createSarvamProvider } from "@/lib/stt/sarvam";
import { requireEnv } from "@/lib/env";

export function buildDeps(): PipelineDeps {
  return {
    db: getDb(),
    stt: createSarvamProvider(),
    llm: gatewayLlm(),
    callbackUrl: `${requireEnv("APP_BASE_URL")}/api/sarvam/webhook`,
    async readAudio(pathname) {
      const result = await get(pathname, { access: "private" });
      if (!result || result.statusCode !== 200) throw new Error("Audio not found");
      const bytes = new Uint8Array(await new Response(result.stream).arrayBuffer());
      return { bytes, filename: pathname.split("/").pop() ?? "audio.webm", contentType: result.blob.contentType };
    },
  };
}
```

- [ ] **Step 4: Recipe routes**

```ts
// app/api/recipes/route.ts
import { NextResponse, after } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth";
import { buildDeps } from "@/lib/deps";
import { startTranscription } from "@/lib/pipeline";
import { createRecipe, listRecipes } from "@/lib/recipes";
import { getDb } from "@/lib/db";

const body = z.object({ audioPathname: z.string().regex(/^recordings\/[A-Za-z0-9._-]+$/), durationSec: z.number().int().min(1).max(7200) });

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const recipe = await createRecipe(getDb(), user.id, parsed.data.audioPathname, parsed.data.durationSec);
  after(() => startTranscription(buildDeps(), recipe.id));
  return NextResponse.json({ recipeId: recipe.id }, { status: 201 });
}

export async function GET() {
  const user = await getSessionUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });
  return NextResponse.json({ recipes: await listRecipes(getDb(), user.id) });
}
```

```ts
// app/api/recipes/[id]/route.ts
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { getRecipeForOwner } from "@/lib/recipes";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return new NextResponse("Not found", { status: 404 });
  const recipe = await getRecipeForOwner(getDb(), id, user.id);
  return recipe ? NextResponse.json({ recipe }) : new NextResponse("Not found", { status: 404 });
}
```

```ts
// app/api/recipes/[id]/retry/route.ts
import { NextResponse, after } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { buildDeps } from "@/lib/deps";
import { getDb } from "@/lib/db";
import { getRecipeForOwner } from "@/lib/recipes";
import { startTranscription } from "@/lib/pipeline";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return new NextResponse("Not found", { status: 404 });
  const recipe = await getRecipeForOwner(getDb(), id, user.id);
  if (!recipe) return new NextResponse("Not found", { status: 404 });
  if (recipe.status !== "failed") return NextResponse.json({ error: "Nothing to retry" }, { status: 409 });
  after(() => startTranscription(buildDeps(), id));
  return NextResponse.json({ ok: true });
}
```

```ts
// app/api/audio/[id]/route.ts
import { NextResponse } from "next/server";
import { get } from "@vercel/blob";
import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { getRecipeForOwner } from "@/lib/recipes";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return new NextResponse("Not found", { status: 404 });
  const recipe = await getRecipeForOwner(getDb(), id, user.id);
  if (!recipe) return new NextResponse("Not found", { status: 404 });
  const result = await get(recipe.audio_pathname, { access: "private" });
  if (!result || result.statusCode !== 200) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(result.stream, { headers: { "Content-Type": result.blob.contentType, "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store" } });
}
```

Seeking in the audio player (HTTP Range) is not handled here. Plan 2 adds it together with the remux decision from the spike.

- [ ] **Step 5: Webhook and cron sweep**

```ts
// app/api/sarvam/webhook/route.ts
import { NextResponse, after } from "next/server";
import { requireEnv } from "@/lib/env";
import { buildDeps } from "@/lib/deps";
import { completeTranscription } from "@/lib/pipeline";
import { verifyWebhookToken } from "@/lib/webhook-auth";

export async function POST(request: Request) {
  if (!verifyWebhookToken(request.headers.get("x-sarvam-job-callback-token"), requireEnv("SARVAM_WEBHOOK_TOKEN"))) {
    return new NextResponse("Forbidden", { status: 403 });
  }
  const payload = (await request.json().catch(() => null)) as { job_id?: string; job_state?: string } | null;
  if (!payload?.job_id) return NextResponse.json({ ok: true });
  if (payload.job_state === "Completed" || payload.job_state === "Failed") {
    const jobId = payload.job_id;
    after(() => completeTranscription(buildDeps(), jobId));
  }
  return NextResponse.json({ ok: true });
}
```

```ts
// app/api/cron/sweep/route.ts
import { NextResponse } from "next/server";
import { requireEnv } from "@/lib/env";
import { buildDeps } from "@/lib/deps";
import { completeTranscription } from "@/lib/pipeline";
import { listStuck } from "@/lib/recipes";

export async function GET(request: Request) {
  if (request.headers.get("authorization") !== `Bearer ${requireEnv("CRON_SECRET")}`) return new NextResponse("Forbidden", { status: 403 });
  const deps = buildDeps();
  const stuck = await listStuck(deps.db, 5);
  const results: string[] = [];
  for (const r of stuck) results.push(await completeTranscription(deps, r.stt_job_id));
  return NextResponse.json({ checked: stuck.length, results });
}
```

```json
// vercel.json
{ "crons": [{ "path": "/api/cron/sweep", "schedule": "0 3 * * *" }] }
```

(Daily is the most frequent a free plan allows. The webhook is the main path; the sweep only rescues missed callbacks. The user can also tap Retry.)

- [ ] **Step 6: [Review focus 5] Cross-user access check**

Add this test to `tests/pipeline.test.ts`:

```ts
import { getRecipeForOwner } from "@/lib/recipes";
it("[review focus 5] another user cannot read a recipe by id", async () => {
  const { db, recipe } = await setup(async () => doneState);
  const other = await upsertUserByPhone(db, "+919123456789", "Ravi");
  expect(await getRecipeForOwner(db, recipe.id, other.id)).toBeNull();
});
```

Run: `npx vitest run`
Expected: all tests PASS. (Every route reads recipes only through `getRecipeForOwner`, which this test pins.)

- [ ] **Step 7: Typecheck and commit**

Run: `npx tsc --noEmit`
Expected: no errors.

```bash
git add -A && git commit -m "feat: recipe, audio, webhook and sweep routes"
```

---

### Task 11: Home and recipe screens

**Files:**
- Create: `components/recipe-status.tsx`, `app/recipes/[id]/page.tsx`
- Modify: `app/page.tsx`, `app/layout.tsx` (title only)

**Interfaces:**
- Consumes: `getSessionUser`, `listRecipes`, `getRecipeForOwner`, `listSegments`, `PendingUploads`.

- [ ] **Step 1: Polling status component**

```tsx
// components/recipe-status.tsx
"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

const label: Record<string, string> = { uploaded: "Saved", transcribing: "Transcribing", structuring: "Writing it up", ready: "Ready", failed: "Needs attention" };

export function RecipeStatus({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const active = status === "uploaded" || status === "transcribing" || status === "structuring";
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => router.refresh(), 4000);
    return () => clearInterval(t);
  }, [active, router]);
  return (
    <span className={`rounded-full px-3 py-1 text-xs ${status === "ready" ? "bg-green-100 text-green-800" : status === "failed" ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-800"}`}>
      {label[status] ?? status}
      {status === "failed" && (
        <button className="ml-2 underline" onClick={async () => { await fetch(`/api/recipes/${id}/retry`, { method: "POST" }); router.refresh(); }}>Retry</button>
      )}
    </span>
  );
}
```

- [ ] **Step 2: Home**

```tsx
// app/page.tsx
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { listRecipes } from "@/lib/recipes";
import { RecipeStatus } from "@/components/recipe-status";
import { PendingUploads } from "@/components/pending-uploads";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const recipes = await listRecipes(getDb(), user.id);
  return (
    <main className="mx-auto max-w-md space-y-6 p-6">
      <h1 className="text-2xl font-semibold">Mother Tongue Kitchen</h1>
      <Link href="/record" className="block rounded-xl bg-red-600 p-6 text-center text-xl font-medium text-white shadow">Record a recipe</Link>
      <PendingUploads />
      <ul className="divide-y rounded border">
        {recipes.length === 0 && <li className="p-4 text-sm text-neutral-600">No recipes yet. Record your first one.</li>}
        {recipes.map((r) => (
          <li key={r.id} className="flex items-center justify-between gap-3 p-4">
            <Link href={`/recipes/${r.id}`} className="min-w-0 flex-1">
              <div className="truncate font-medium">{r.title ?? "Untitled recipe"}</div>
              <div className="text-xs text-neutral-500">{new Date(r.created_at).toLocaleDateString("en-IN")} · {Math.round(r.duration_sec / 60) || "<1"} min</div>
            </Link>
            <RecipeStatus id={r.id} status={r.status} />
          </li>
        ))}
      </ul>
    </main>
  );
}
```

- [ ] **Step 3: Recipe page**

```tsx
// app/recipes/[id]/page.tsx
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { getRecipeForOwner, listSegments } from "@/lib/recipes";
import { RecipeStatus } from "@/components/recipe-status";

export const dynamic = "force-dynamic";

export default async function RecipePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const recipe = await getRecipeForOwner(getDb(), id, user.id);
  if (!recipe) notFound();
  const segments = await listSegments(getDb(), id);
  return (
    <main className="mx-auto max-w-md space-y-6 p-6">
      <Link href="/" className="text-sm underline">Back</Link>
      <div className="flex items-start justify-between gap-3">
        <h1 className="text-2xl font-semibold">{recipe.title ?? "Untitled recipe"}</h1>
        <RecipeStatus id={recipe.id} status={recipe.status} />
      </div>
      <audio controls className="w-full" src={`/api/audio/${recipe.id}`} />
      {recipe.note === "no_speech" && <p className="rounded bg-amber-50 p-3 text-sm">We could not hear any speech in this recording. Please try recording again.</p>}
      {recipe.status === "failed" && <p className="rounded bg-red-50 p-3 text-sm">{recipe.error ?? "Something went wrong."} Tap Retry above.</p>}
      {recipe.ingredients && recipe.ingredients.length > 0 && (
        <section><h2 className="mb-2 font-semibold">Ingredients</h2>
          <ul className="list-disc space-y-1 pl-5">{recipe.ingredients.map((i, n) => <li key={n}>{i.quantity ? `${i.quantity} ` : ""}{i.name}</li>)}</ul></section>
      )}
      {recipe.steps && recipe.steps.length > 0 && (
        <section><h2 className="mb-2 font-semibold">Steps</h2>
          <ol className="list-decimal space-y-2 pl-5">{recipe.steps.map((s, n) => <li key={n}>{s}</li>)}</ol></section>
      )}
      {recipe.note === "structure_failed" && <p className="rounded bg-amber-50 p-3 text-sm">We could not organise this recipe yet. The full transcript is below.</p>}
      {segments.length > 0 && (
        <section><h2 className="mb-2 font-semibold">Transcript</h2>
          <p className="whitespace-pre-wrap leading-relaxed">{segments.map((s) => s.edited_text ?? s.text).join(" ")}</p></section>
      )}
    </main>
  );
}
```

- [ ] **Step 4: Typecheck, lint, test**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: clean, all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: home and recipe screens with live status"
```

---

### Task 12: Deploy a preview and prove it on real phones

**Files:** none new. Record results in `docs/device-checks.md`.

**Interfaces:** none. This task is the spec's success gate for Plan 1.

- [ ] **Step 1: Link, set env, deploy**

```bash
vercel link
vercel blob create-store mtk-recordings --access private   # then connect it to the project
vercel env add SARVAM_API_KEY; vercel env add SARVAM_WEBHOOK_TOKEN; vercel env add AI_GATEWAY_API_KEY
vercel env add STRUCTURE_MODEL; vercel env add SESSION_SECRET; vercel env add CRON_SECRET
vercel env add AUTH_MODE   # value: dev  (Preview only; never Production)
vercel env add APP_BASE_URL   # the preview URL, or a stable preview alias
vercel deploy
```

Run `npm run migrate` against the Neon URL used by the deployment first.

- [ ] **Step 2: Smoke test the full path in a desktop browser**

Open the preview URL, sign in on `/login`, tap **Record a recipe**, speak for 20 seconds, stop. Expect: home shows the recipe as Saved, then Transcribing, then Ready within about a minute; the recipe page plays the audio and shows ingredients, steps and transcript. If it stays on Transcribing past 5 minutes, check Sarvam's webhook reaches `/api/sarvam/webhook` (Vercel logs) and that `APP_BASE_URL` is publicly reachable.

- [ ] **Step 3: Run the device checks on a low-end Android phone (Chrome) and write the results down**

| Check | Pass condition |
|---|---|
| Normal 3-minute recording in Hindi | Reaches Ready with sensible text |
| Lock the screen mid-recording for 30 s | Recording continues, or on reopening "Upload now" recovers all but the last 5 s |
| Incoming call mid-recording | Same as above |
| Airplane mode, record, stop | Shows "Saved on this phone"; turn network on, tap Upload now; recipe appears |
| Close the tab mid-recording | On reopen, the pending banner appears; upload recovers the audio |
| Tap stop at once | "That was too short, try again." and no recipe is created |
| Record in a silent room | Ready with "could not hear any speech" note |
| Same recording on a second phone | Audio plays; other account cannot open the recipe URL |

- [ ] **Step 4: Commit the results**

```bash
git add docs/device-checks.md && git commit -m "docs: device check results for Plan 1"
```

**Gate:** zero lost recordings across the checks. Any loss is a blocker before Plan 2. Then write Plan 2 using `docs/spike/sarvam-findings.md` and these device results.

---

## Self-Review

**Spec coverage**
- Sign-in: dev login only here; WhatsApp OTP, sharing, review screen, search are Plan 2 (stated in Scope). The spec's build order step 5/6 and screens 5-6 are therefore intentionally outside this plan.
- Home with one-tap Record, status list: Task 11. Record screen (timer, level, pause, stop, no form): Task 6. Recipe view with audio, ingredients, steps, transcript: Task 11.
- Crash-safe recording, wake lock, recovery, upload-then-delete: Tasks 5-6. Private audio and authenticated playback: Tasks 6, 10.
- Pipeline with independent failure handling (STT retry via button, LLM fallback to raw transcript): Tasks 7-10. Sarvam batch with chunk timestamps: Task 7.
- Consent line for recording someone else: not built; spec leaves wording open. Listed as a Plan 2 item with the OTP/sharing work.
- Spec risks 1, 1a, 2 (browser recording) are handled by Task 1 and Task 12; risk 3 (WhatsApp) by Task 0; risk 4 (search) in Plan 2.

**Placeholder scan:** none left. Three places depend on facts only a real call can confirm and say so explicitly with a verification step: the Sarvam SDK method names (Tasks 1 and 7), the Neon `sql.query` return shape (Task 3 Step 7), and the AI Gateway model id (Tasks 1 and 8).

**Type consistency:** `Segment`/`Transcript`/`SttProvider` (Task 7) are used unchanged in Task 9. `Recipe.status` values match the SQL check constraint in Task 3 and the labels in Task 11. `PipelineDeps.readAudio` returns `{ bytes, filename, contentType }`, matching `SttProvider.start`'s first argument. `Uploader` returns `{ recipeId }`, matching `POST /api/recipes`.

**Review Focus coverage:** items 1 to 5 each have a test in the task named in brackets.
