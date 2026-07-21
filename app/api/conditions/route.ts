import { buildQuickBriefing } from "@/lib/briefing";
import { latestConditions } from "@/lib/clickhouse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const readings = await latestConditions();
    return Response.json({ readings, briefing: buildQuickBriefing(readings) });
  } catch (error) {
    return Response.json({ readings: [], error: error instanceof Error ? error.message : "Could not load saved conditions" }, { status: 503 });
  }
}
