import { randomUUID } from "node:crypto";
import { TriggerChatTransport } from "@trigger.dev/sdk/chat";
import { mintChatAccessToken, startChatSession } from "../app/actions";
import { query } from "../lib/clickhouse";
import type { PaddleTripData } from "../lib/chat-types";

async function main() {
  const chatId = `local-trip-${randomUUID()}`;
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
    messages: [{ id: messageId, role: "user", parts: [{ type: "text", text: "Log today's Hoboken–Pier 66 paddle as rough." }] }],
    abortSignal: undefined,
  });

  let answer = "";
  let trip: PaddleTripData | undefined;
  const chunkTypes: string[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value: chunk } = await reader.read();
    if (done) break;
    chunkTypes.push(chunk.type);
    if (chunk.type === "text-delta") answer += chunk.delta;
    if (chunk.type === "data-paddle-trip") trip = chunk.data as PaddleTripData;
    if (chunk.type === "error") throw new Error(String(chunk.errorText));
  }

  if (!trip) throw new Error(`No trip saved. Chunks: ${chunkTypes.join(", ") || "none"}`);
  console.log("streamed trip:", trip);
  console.log("---");
  console.log(answer.trim());
  console.log("---");

  const rows = await query<{ trip_id: string; route: string; rating: string; started_at: string; notes: string }>(
    "SELECT toString(trip_id) AS trip_id, route, rating, toString(started_at) AS started_at, notes FROM trips WHERE trip_id = {id:String}",
    { id: trip.tripId },
  );
  if (!rows.length) throw new Error("Trip not found in ClickHouse after insert.");
  console.log("ClickHouse row:", rows[0]);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
