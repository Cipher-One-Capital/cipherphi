import { sponsorContribution } from "@/lib/server/demo";
import { handle } from "@/lib/server/route";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = await req.json();
  return handle(async () => ({ hash: await sponsorContribution(String(body.signed)) }));
}
