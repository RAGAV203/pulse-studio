import { NextResponse, type NextRequest } from "next/server";
import { assertDuration, fetchInfo, YtError } from "@/lib/server/ytdlp";
import { parseYouTubeId } from "@/lib/youtube";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url") ?? "";
  const id = parseYouTubeId(url);
  if (!id) return NextResponse.json({ error: "That is not a valid YouTube video link." }, { status: 400 });
  try {
    const info = await fetchInfo(id);
    const tooLong = info.duration > 0 && info.duration > 360;
    try {
      assertDuration(info);
    } catch (e) {
      return NextResponse.json({ info, allowed: false, error: (e as Error).message }, { status: tooLong ? 200 : 422 });
    }
    return NextResponse.json({ info, allowed: true });
  } catch (e) {
    const status = e instanceof YtError ? e.status : 500;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}
