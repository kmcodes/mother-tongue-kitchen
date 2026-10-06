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
