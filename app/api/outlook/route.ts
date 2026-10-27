import { getOutlookInputs } from "@/lib/outlook-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Caching happens per fetch inside the sources, not per route.
export async function GET() {
  return Response.json(await getOutlookInputs(new Date()));
}
