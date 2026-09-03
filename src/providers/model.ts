export interface ModelConfig {
  apiKey: string;
  model: string;
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ModelProvider {
  chatJson(messages: ChatMessage[]): Promise<unknown>;
}

/**
 * Minimal OpenAI-compatible chat client. Kimi (Moonshot) exposes the same
 * `/v1/chat/completions` shape, so this provider is intentionally small and
 * provider-agnostic; the base URL is the only account-specific part.
 */
export function createModelProvider(config: ModelConfig): ModelProvider {
  const baseUrl = (config.baseUrl ?? "https://api.moonshot.cn/v1").replace(
    /\/$/,
    "",
  );
  const fetcher = config.fetch ?? globalThis.fetch;

  return {
    async chatJson(messages: ChatMessage[]): Promise<unknown> {
      const response = await fetcher(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: config.model,
          messages,
          response_format: { type: "json_object" },
        }),
      });

      const text = await response.text();
      if (!response.ok) {
        throw new Error(
          `Model API request failed (${response.status}): ${text}`,
        );
      }

      let data: unknown;
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error(`Model API returned non-JSON: ${text.slice(0, 200)}`);
      }

      const content = (
        data as { choices?: Array<{ message?: { content?: unknown } }> }
      ).choices?.[0]?.message?.content;
      if (typeof content !== "string") {
        throw new Error("Model API returned no text content");
      }

      try {
        return JSON.parse(content);
      } catch {
        throw new Error(
          `Model returned invalid JSON: ${content.slice(0, 200)}`,
        );
      }
    },
  };
}
