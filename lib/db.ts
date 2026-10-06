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
