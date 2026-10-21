import { NextResponse } from "next/server";
import { DemoError } from "./demo";

/** Run a route handler, turning a `DemoError` into a JSON error a visitor can read. */
export async function handle<T>(fn: () => Promise<T>) {
  try {
    return NextResponse.json(await fn());
  } catch (err) {
    if (err instanceof DemoError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error(err);
    return NextResponse.json(
      { error: "Something went wrong on the demo server. Try again in a moment." },
      { status: 500 },
    );
  }
}
