import { release } from "@/lib/server/demo";
import { stream } from "@/lib/server/route";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  const body = await req.json();
  return stream((stage) => release(String(body.contribution), true, stage));
}
