import fs from "node:fs";
import path from "node:path";
import { getDb } from "../lib/db";
import { runMigrations } from "../lib/migrate";

const dir = path.join(process.cwd(), "db/migrations");
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).map((name) => ({ name, sql: fs.readFileSync(path.join(dir, name), "utf8") }));
runMigrations(getDb(), files).then((a) => console.log("applied:", a.length ? a.join(", ") : "none"));
