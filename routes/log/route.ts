import { NextResponse } from "next/server";
import {
  applyPreferenceEvent,
  PreferenceEventType,
} from "@/lib/server/preferences";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { creatorId, type, payload } = body as {
      creatorId?: string;
      type?: PreferenceEventType;
      payload?: Record<string, unknown>;
    };

    if (!creatorId || !type) {
      return NextResponse.json(
        { error: "Missing creatorId or type" },
        { status: 400 }
      );
    }

    const profile = applyPreferenceEvent({ creatorId, type, payload });
    return NextResponse.json({ ok: true, profile });
  } catch (error) {
    return NextResponse.json(
      { error: "Log event failed", details: String(error) },
      { status: 500 }
    );
  }
}
