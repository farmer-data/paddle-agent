"use server";
import { auth } from "@trigger.dev/sdk";
import { chat } from "@trigger.dev/sdk/ai";

export const startChatSession = chat.createStartSessionAction("paddle-agent");
export async function mintChatAccessToken(chatId: string) {
  return auth.createPublicToken({ scopes: { read: { sessions: chatId }, write: { sessions: chatId } }, expirationTime: "1h" });
}
