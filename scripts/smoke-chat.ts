import { randomUUID } from "node:crypto";
import { TriggerChatTransport } from "@trigger.dev/sdk/chat";
import { mintChatAccessToken, startChatSession } from "../app/actions";
import type { PaddleBriefingData } from "../lib/chat-types";

async function main() {
  const chatId = `local-smoke-${randomUUID()}`;
  const messageId = randomUUID();
  const transport = new TriggerChatTransport({
    task: "paddle-agent",
    accessToken: ({ chatId: id }) => mintChatAccessToken(id),
    startSession: ({ chatId: id, clientData }) => startChatSession({ chatId: id, clientData }),
  });

  const stream = await transport.sendMessages({
    trigger: "submit-message",
    chatId,
    messageId,
    messages: [{ id: messageId, role: "user", parts: [{ type: "text", text: "Show current Hudson conditions" }] }],
    abortSignal: undefined,
  });

  let answer = "";
  let chart: PaddleBriefingData | undefined;
  const chunkTypes: string[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value: chunk } = await reader.read();
    if (done) break;
    chunkTypes.push(chunk.type);
    if (chunk.type === "text-delta") answer += chunk.delta;
    if (chunk.type === "data-paddle-briefing") chart = chunk.data as PaddleBriefingData;
    if (chunk.type === "error") throw new Error(String(chunk.errorText));
  }

  if (!answer.trim()) throw new Error(`Paddle Agent returned no text. Chunks: ${chunkTypes.join(", ") || "none"}`);
  if (!chart?.hourly.length) throw new Error(`Paddle Agent returned no wind chart data. Chunks: ${chunkTypes.join(", ") || "none"}`);
  if (!chart.current || !chart.hourly.some((hour) => hour.current !== null)) throw new Error("Paddle Agent returned no current-flow chart data.");
  console.log(`chatId: ${chatId}`);
  console.log(`chart: ${chart.hourly.length} wind points, current flow included`);
  console.log(answer);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
