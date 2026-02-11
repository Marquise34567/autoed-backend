import { NextResponse } from "next/server";
import { getPreferenceProfile } from "@/lib/server/preferences";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const creatorId = searchParams.get("creatorId");
  if (!creatorId) {
    return NextResponse.json({ error: "Missing creatorId" }, { status: 400 });
  }
  const profile = getPreferenceProfile(creatorId);
  return NextResponse.json({ profile });
}
