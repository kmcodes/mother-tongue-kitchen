import type { Db } from "@/lib/db";

// Drivers run one statement per call, so split on a semicolon at end of line.
function statements(sql: string): string[] {
  return sql.split(/;\s*\n/).map((s) => s.trim().replace(/;$/, "")).filter(Boolean);
}

export async function runMigrations(
  db: Db,
  files: { name: string; sql: string }[],
): Promise<string[]> {
  await db.query("create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())");
  const done = new Set((await db.query<{ name: string }>("select name from schema_migrations")).map((r) => r.name));
  const applied: string[] = [];
  for (const f of [...files].sort((a, b) => a.name.localeCompare(b.name))) {
    if (done.has(f.name)) continue;
    for (const stmt of statements(f.sql)) await db.query(stmt);
    await db.query("insert into schema_migrations (name) values ($1)", [f.name]);
    applied.push(f.name);
  }
  return applied;
}
