import { NextResponse, type NextRequest } from "next/server";
import { fetchInfo, YtError } from "@/lib/server/youtube-extract";
import { parseYouTubeId } from "@/lib/youtube";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url") ?? "";
  const id = parseYouTubeId(url);
  if (!id) return NextResponse.json({ error: "That is not a valid YouTube video link." }, { status: 400 });
  try {
    const { allowed, reason, ...info } = await fetchInfo(id);
    return NextResponse.json(allowed ? { info, allowed } : { info, allowed, error: reason });
  } catch (e) {
    const status = e instanceof YtError ? e.status : 500;
    console.error("[youtube info]", e);
    return NextResponse.json({ error: e instanceof YtError ? e.message : "Could not read this video." }, { status });
  }
}
