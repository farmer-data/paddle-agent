import { describe, expect, it } from "vitest";
import { CONFIG } from "./config";
import { fitHistory, historyChars } from "./chat-history";

const text = (t: string) => ({ parts: [{ type: "text", text: t }] });

describe("chat history", () => {
  it("counts text as-is and every other part serialized", () => {
    expect(historyChars([text("abcd")])).toBe(4);
    expect(historyChars([{ parts: [{ type: "data-x", data: "yy" }] }])).toBe(JSON.stringify({ type: "data-x", data: "yy" }).length);
  });
  it("sends at most the last N messages, drops UI-only data parts, and trims oldest until under the cap", () => {
    const big = (i: number) => ({ id: String(i), parts: [{ type: "text", text: "y".repeat(5000) }, { type: "data-paddle-briefing", data: { hours: "z".repeat(9000) } }] });
    const all = Array.from({ length: 20 }, (_, i) => big(i));
    const sent = fitHistory(all);
    expect(sent.every((m) => m.parts.every((p) => !p.type.startsWith("data-")))).toBe(true);
    expect(historyChars(sent)).toBeLessThanOrEqual(CONFIG.chat.maxHistoryChars);
    expect(sent.at(-1)!.id).toBe("19");
    expect(sent.length).toBeLessThanOrEqual(CONFIG.chat.historyMessages);
  });
  it("always keeps the newest message", () => {
    expect(fitHistory([text("x".repeat(30_000))])).toHaveLength(1);
  });
});
