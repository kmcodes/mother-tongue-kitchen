export type StoppableRecorder = {
  state: string;
  addEventListener(type: "stop", cb: () => void, opts?: { once: boolean }): void;
  stop(): void;
};

// A MediaRecorder that already stopped itself (mic taken by a call) never fires "stop" again.
export function stopRecorder(rec: StoppableRecorder): Promise<void> {
  if (rec.state === "inactive") return Promise.resolve();
  return new Promise((resolve) => {
    rec.addEventListener("stop", () => resolve(), { once: true });
    rec.stop();
  });
}
