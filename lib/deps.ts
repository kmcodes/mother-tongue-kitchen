import { get } from "@vercel/blob";
import { getDb } from "@/lib/db";
import { gatewayLlm } from "@/lib/llm";
import type { PipelineDeps } from "@/lib/pipeline";
import { createSarvamProvider } from "@/lib/stt/sarvam";
import { requireEnv } from "@/lib/env";

export function buildDeps(): PipelineDeps {
  return {
    db: getDb(),
    stt: createSarvamProvider(),
    llm: gatewayLlm(),
    callbackUrl: `${requireEnv("APP_BASE_URL")}/api/sarvam/webhook`,
    async readAudio(pathname) {
      const result = await get(pathname, { access: "private" });
      if (!result || result.statusCode !== 200) throw new Error("Audio not found");
      const bytes = new Uint8Array(await new Response(result.stream).arrayBuffer());
      return { bytes, filename: pathname.split("/").pop() ?? "audio.webm", contentType: result.blob.contentType };
    },
  };
}
