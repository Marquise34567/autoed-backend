import { NextResponse } from "next/server";

// Ensure this app route is rendered at runtime (uses `headers`/request data)
export const dynamic = "force-dynamic";

function backend() {
  // Prefer server BACKEND_URL, fall back to NEXT_PUBLIC_API_BASE_URL for local/dev
  let raw = process.env.BACKEND_URL || process.env.NEXT_PUBLIC_API_BASE_URL || "";
  if (!raw) {
    // Don't throw during build; warn and return empty so build can finish.
    console.warn("BACKEND_URL not set — proxy calls will fail at runtime");
    return "";
  }

  raw = raw.trim().replace(/\/+$/, "");
  if (!raw.startsWith("http://") && !raw.startsWith("https://")) {
    raw = `https://${raw}`;
  }
  return raw;
}

export async function GET(req: Request) {
  const upstream = `${backend()}/api/userdoc`;
  try {
    const auth = req.headers.get("authorization") || "";

    const res = await fetch(upstream, {
      method: "GET",
      headers: auth ? { authorization: auth } : {},
      cache: "no-store",
    });

    const ct = res.headers.get("content-type") || "";
    const body = ct.includes("application/json") ? await res.json() : await res.text();

    // If backend returns 401 missing_token, pass it through (do NOT convert to 502)
    return NextResponse.json(body, { status: res.status });
  } catch (e: any) {
    console.error("[api/proxy/userdoc GET] crash", e?.stack || e);
    return NextResponse.json({ error: "bad_gateway", upstream, detail: String(e?.message || e) }, { status: 502 });
  }
}
