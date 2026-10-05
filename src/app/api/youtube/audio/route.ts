import { NextResponse, type NextRequest } from "next/server";
import { assertDuration, fetchInfo, streamAudio, YtError } from "@/lib/server/ytdlp";
import { isValidVideoId } from "@/lib/youtube";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Very small in-process guard so one client cannot start dozens of extractions.
let active = 0;
const MAX_ACTIVE = 3;

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id") ?? "";
  if (!isValidVideoId(id)) return NextResponse.json({ error: "Invalid video id" }, { status: 400 });
  if (active >= MAX_ACTIVE) return NextResponse.json({ error: "Server busy, try again shortly." }, { status: 429 });
  active++;
  try {
    // Re-validate length on the server: never trust the client.
    const info = await fetchInfo(id);
    assertDuration(info);
    const stream = streamAudio(id, req.signal);
    const reader = stream.getReader();
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const { done, value } = await reader.read();
          if (done) {
            active--;
            controller.close();
          } else controller.enqueue(value);
        } catch (e) {
          active--;
          controller.error(e);
        }
      },
      cancel() {
        active--;
        void reader.cancel();
      },
    });
    return new Response(body, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Cache-Control": "no-store",
        "X-Title": encodeURIComponent(info.title),
        "X-Duration": String(info.duration),
      },
    });
  } catch (e) {
    active--;
    const status = e instanceof YtError ? e.status : 500;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}
