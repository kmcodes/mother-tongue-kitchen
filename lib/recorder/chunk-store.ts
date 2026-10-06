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
