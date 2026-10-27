// Browser-safe: used by the chat request schema on the server and by the chat sheet before it sends.
import { CONFIG } from "./config";

type PartLike = { type?: unknown; text?: unknown; [key: string]: unknown };
type MessageLike = { parts?: readonly PartLike[] };

// Characters a message costs the model: text as-is, every other part (tool calls and outputs, data parts) serialized.
export function messageChars(message: MessageLike): number {
  let n = 0;
  for (const part of message.parts ?? []) {
    if (part.type === "text" && typeof part.text === "string") n += part.text.length;
    else { try { n += JSON.stringify(part).length; } catch { n += Infinity; } }
  }
  return n;
}

export const historyChars = (messages: readonly MessageLike[]) => messages.reduce((sum, m) => sum + messageChars(m), 0);

// The slice of history the server will use: the last N messages.
export const lastMessages = <T,>(messages: readonly T[]): T[] => messages.slice(-CONFIG.chat.historyMessages);

// Client side: the last N messages, dropping the oldest until the total fits the server's cap, so a long chat never locks itself out.
// UI-only data parts (briefing charts etc.) are never read by the model and are stripped.
export function fitHistory<T extends MessageLike>(messages: readonly T[]): T[] {
  const stripped = lastMessages(messages).map((m) => ({ ...m, parts: (m.parts ?? []).filter((p) => !(typeof p.type === "string" && p.type.startsWith("data-"))) }) as T);
  while (stripped.length > 1 && historyChars(stripped) > CONFIG.chat.maxHistoryChars) stripped.shift();
  return stripped;
}
