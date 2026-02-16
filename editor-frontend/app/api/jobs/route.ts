import { NextResponse } from "next/server";

function backend() {
  let raw = process.env.BACKEND_URL || "";
  if (!raw) throw new Error("BACKEND_URL missing (set in Vercel).");

  raw = raw.trim().replace(/\/+$/, "");
  if (!raw.startsWith("http://") && !raw.startsWith("https://")) {
    raw = `https://${raw}`;
  }
  return raw;
}

function passAuth(req: Request) {
  const a = req.headers.get("authorization");
  return a ? { authorization: a } : {};
}

async function readBody(res: Response) {
  const ct = res.headers.get("content-type") || "";
  return ct.includes("application/json") ? await res.json() : await res.text();
}

export async function GET(req: Request) {
  try {
    const u = new URL(req.url);
    const upstream = `${backend()}/api/jobs${u.search}`;

    const res = await fetch(upstream, {
      method: "GET",
      headers: { ...passAuth(req) },
      cache: "no-store",
    });

    const body = await readBody(res);
    return NextResponse.json(body, { status: res.status });
  } catch (e: any) {
    console.error("[api/jobs GET] crash", e?.stack || e);
    return NextResponse.json({ error: "internal_error", detail: String(e?.message || e) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const upstream = `${backend()}/api/jobs`;
    const payload = await req.json().catch(() => ({}));

    const res = await fetch(upstream, {
      method: "POST",
      headers: { "content-type": "application/json", ...passAuth(req) },
      body: JSON.stringify(payload),
    });

    const body = await readBody(res);
    return NextResponse.json(body, { status: res.status });
  } catch (e: any) {
    console.error("[api/jobs POST] crash", e?.stack || e);
    return NextResponse.json({ error: "internal_error", detail: String(e?.message || e) }, { status: 500 });
  }
}
