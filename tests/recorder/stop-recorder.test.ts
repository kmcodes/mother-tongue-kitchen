import { describe, it, expect, vi } from "vitest";
import { stopRecorder } from "@/lib/recorder/stop-recorder";
function fakeRec(state: string) {
  let onStop: () => void = () => {};
  return {
    state,
    addEventListener: vi.fn((_t: "stop", cb: () => void) => { onStop = cb; }),
    stop: vi.fn(() => { setTimeout(() => onStop(), 5); }),
  };
}
describe("stopRecorder", () => {
  it("stops an active recorder and waits for its stop event", async () => {
    const rec = fakeRec("recording");
    await stopRecorder(rec);
    expect(rec.stop).toHaveBeenCalledTimes(1);
  });
  it("[I2] returns at once when the recorder already stopped itself", async () => {
    const rec = fakeRec("inactive");
    await expect(Promise.race([stopRecorder(rec), new Promise((r) => setTimeout(() => r("hung"), 200))])).resolves.toBeUndefined();
    expect(rec.stop).not.toHaveBeenCalled();
  });
});
