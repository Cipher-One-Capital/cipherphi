import { buildOnboarding, submitOnboarding } from "@/lib/server/demo";
import { handle } from "@/lib/server/route";

export const runtime = "nodejs";

/** `{address}` builds the sponsored onboarding; `{address, signed}` submits it. */
export async function POST(req: Request) {
  const body = await req.json();
  return handle(async () =>
    body.signed
      ? { hash: await submitOnboarding(String(body.signed)) }
      : buildOnboarding(String(body.address)),
  );
}
