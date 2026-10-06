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

// PGlite takes seconds to start, so each test file boots one instance and wipes the tables between tests.
let shared: Promise<Db> | undefined;
export async function makeTestDb(): Promise<Db> {
  shared ??= (async () => {
    const db = fromPglite(new PGlite());
    await runMigrations(db, migrationFiles());
    return db;
  })();
  const db = await shared;
  await db.query("truncate users, recipes, segments restart identity cascade");
  return db;
}
