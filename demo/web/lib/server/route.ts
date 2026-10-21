import { NextResponse } from "next/server";
import { DemoError } from "./demo";

const FAILED = "Something went wrong on the demo server. Try again in a moment.";

/** Run a route handler, turning a `DemoError` into a JSON error a visitor can read. */
export async function handle<T>(fn: () => Promise<T>) {
  try {
    return NextResponse.json(await fn());
  } catch (err) {
    if (err instanceof DemoError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error(err);
    return NextResponse.json({ error: FAILED }, { status: 500 });
  }
}

/**
 * Run a long route handler as a stream of JSON lines, so the page can show
 * each step as the server reaches it: `{stage}` as a step starts, then one
 * `{result}` or `{error, status}` to finish.
 */
export function stream<S extends string, T>(fn: (stage: (s: S) => void) => Promise<T>) {
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    async start(controller) {
      const send = (line: unknown) => controller.enqueue(encoder.encode(JSON.stringify(line) + "\n"));
      try {
        send({ result: await fn((stage) => send({ stage })) });
      } catch (err) {
        if (err instanceof DemoError) send({ error: err.message, status: err.status });
        else {
          console.error(err);
          send({ error: FAILED, status: 500 });
        }
      }
      controller.close();
    },
  });
  return new Response(body, {
    headers: { "content-type": "application/x-ndjson", "cache-control": "no-store" },
  });
}
