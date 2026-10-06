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
