import { isIP } from "node:net";
import { convertToModelMessages, createUIMessageStream, createUIMessageStreamResponse, isTextUIPart, stepCountIs, streamText } from "ai";
import { qwenModel } from "@/lib/agent/model";
import { systemPrompt } from "@/lib/agent/prompt";
import { createPaddleTools } from "@/lib/agent/tools";
import { chatRequestSchema, type PaddleChatUIMessage } from "@/lib/agent/types";
import { CONFIG } from "@/lib/config";
import { counterStoreFromEnv } from "@/lib/counter-store";
import { getOutlookInputs } from "@/lib/outlook-data";
import { checkChatLimits } from "@/lib/rate-limit";
import { zoneById } from "@/lib/zones";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const text = (message: PaddleChatUIMessage) => message.parts.filter(isTextUIPart).map((p) => p.text).join("");

// Only a syntactically valid IP is trusted: the address becomes part of the rate-limit counter key.
function clientIp(headers: Headers): string {
  const candidate = (headers.get("x-real-ip") ?? headers.get("x-forwarded-for")?.split(",")[0] ?? "").trim();
  return isIP(candidate) !== 0 ? candidate : "unknown";
}

export async function POST(request: Request) {
  let json: unknown;
  try { json = await request.json(); } catch { return new Response("Bad request", { status: 400 }); }
  const parsed = chatRequestSchema.safeParse(json);
  if (!parsed.success) return new Response(parsed.error.issues[0]?.message ?? "Bad request", { status: 400 });
  const { zoneId, mode, trips } = parsed.data;
  const messages = parsed.data.messages as PaddleChatUIMessage[];

  // Every user message in the history is checked, not just the last: the client controls what it replays.
  const userMessages = messages.filter((m) => m.role === "user");
  if (!userMessages.length || userMessages.some((m) => text(m).length > CONFIG.chat.maxMessageChars)) {
    return new Response(`Please keep questions under ${CONFIG.chat.maxMessageChars} characters.`, { status: 400 });
  }

  const now = new Date();
  const limit = await checkChatLimits(counterStoreFromEnv(process.env), clientIp(request.headers), now);
  if (!limit.ok) return new Response(limit.message, { status: limit.status });

  const inputs = await getOutlookInputs(now);
  let modelMessages;
  try { modelMessages = await convertToModelMessages(messages.slice(-CONFIG.chat.historyMessages)); } catch { return new Response("Bad request", { status: 400 }); }

  const stream = createUIMessageStream<PaddleChatUIMessage>({
    execute: ({ writer }) => {
      const result = streamText({
        model: qwenModel(),
        system: systemPrompt(zoneById(zoneId), mode, now),
        messages: modelMessages,
        tools: createPaddleTools({ write: (part) => writer.write(part), zoneId, mode, trips, inputs, now, loadInputs: (dates) => getOutlookInputs(now, dates) }),
        stopWhen: stepCountIs(CONFIG.chat.maxSteps),
        maxOutputTokens: CONFIG.chat.maxOutputTokens,
      });
      writer.merge(result.toUIMessageStream());
    },
  });
  return createUIMessageStreamResponse({ stream });
}
