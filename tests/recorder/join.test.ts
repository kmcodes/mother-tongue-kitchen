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
