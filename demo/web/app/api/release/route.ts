import { release } from "@/lib/server/demo";
import { handle } from "@/lib/server/route";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  const body = await req.json();
  return handle(() => release(String(body.contribution), true));
}
