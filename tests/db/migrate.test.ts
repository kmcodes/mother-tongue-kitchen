import { describe, it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { runMigrations } from "@/lib/migrate";
import { fromPglite, makeTestDb } from "@/tests/helpers/test-db";

describe("runMigrations", () => {
  it("applies each file once, runs multi-statement files, and is idempotent", async () => {
    const db = fromPglite(new PGlite());
    const files = [{ name: "001_a.sql", sql: "create table t (id int);\ncreate table u (id int);\n" }];
    expect(await runMigrations(db, files)).toEqual(["001_a.sql"]);
    expect(await runMigrations(db, files)).toEqual([]);
    await db.query("insert into t values (1)");
    expect((await db.query("select * from t")).length).toBe(1);
    expect((await db.query("select * from u")).length).toBe(0);
  });

  it("creates the real schema", async () => {
    const db = await makeTestDb();
    const rows = await db.query<{ table_name: string }>("select table_name from information_schema.tables where table_schema = 'public'");
    expect(rows.map((r) => r.table_name).sort()).toEqual(["recipes", "schema_migrations", "segments", "users"]);
  });
});
