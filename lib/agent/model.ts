import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

const DEFAULT_BASE_URL = "https://dashscope-intl.aliyuncs.com/compatible-mode/v1";

// Server-only. The key comes from QWEN_API_KEY; with none set the provider call fails and the stream reports an error.
export function qwenModel() {
  const qwen = createOpenAICompatible({
    name: "qwen",
    baseURL: process.env.QWEN_BASE_URL ?? DEFAULT_BASE_URL,
    apiKey: process.env.QWEN_API_KEY,
  });
  return qwen.chatModel(process.env.QWEN_MODEL ?? "qwen-plus");
}
