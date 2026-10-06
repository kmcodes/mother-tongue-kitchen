import { requireEnv } from "@/lib/env";
export interface LlmClient { complete(system: string, user: string): Promise<string> }

export function gatewayLlm(): LlmClient {
  return {
    async complete(system, user) {
      const res = await fetch("https://ai-gateway.vercel.sh/v1/chat/completions", {
        method: "POST",
        signal: AbortSignal.timeout(60_000),
        headers: { authorization: `Bearer ${requireEnv("AI_GATEWAY_API_KEY")}`, "content-type": "application/json" },
        body: JSON.stringify({ model: requireEnv("STRUCTURE_MODEL"), temperature: 0, messages: [{ role: "system", content: system }, { role: "user", content: user }] }),
      });
      if (!res.ok) throw new Error(`LLM request failed: ${res.status}`);
      const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      const content = json.choices?.[0]?.message?.content;
      if (!content) throw new Error("LLM returned no content");
      return content;
    },
  };
}
