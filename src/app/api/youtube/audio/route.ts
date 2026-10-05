import { NextResponse, type NextRequest } from "next/server";
import { streamAudio, YtError } from "@/lib/server/ytdlp";
import { isValidVideoId } from "@/lib/youtube";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// 60 s is allowed on every Vercel plan; a ≤ 6 min audio stream (~6 MB) downloads well within it.
export const maxDuration = 60;

// Very small in-process guard so one client cannot start dozens of extractions.
let active = 0;
const MAX_ACTIVE = 3;

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id") ?? "";
  if (!isValidVideoId(id)) return NextResponse.json({ error: "Invalid video id" }, { status: 400 });
  if (active >= MAX_ACTIVE) return NextResponse.json({ error: "Server busy, try again shortly." }, { status: 429 });
  active++;
  let released = false;
  const release = () => {
    if (!released) {
      released = true;
      active--;
    }
  };
  try {
    // The 6-minute limit is enforced server-side inside streamAudio (never trust the client).
    const stream = await streamAudio(id, req.signal);
    const reader = stream.getReader();
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const { done, value } = await reader.read();
          if (done) {
            release();
            controller.close();
          } else controller.enqueue(value);
        } catch (e) {
          release();
          controller.error(e);
        }
      },
      cancel() {
        release();
        void reader.cancel();
      },
    });
    return new Response(body, {
      headers: { "Content-Type": "application/octet-stream", "Cache-Control": "no-store" },
    });
  } catch (e) {
    release();
    const status = e instanceof YtError ? e.status : 500;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}
