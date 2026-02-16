export const runtime = "nodejs";

import { NextResponse } from "next/server";

const BACKEND = process.env.BACKEND_ORIGIN; // e.g. https://autoed-backend-production.up.railway.app

function stripBadHeaders(inHeaders: Headers) {
  const h = new Headers(inHeaders);
  h.delete("origin");
  h.delete("referer");
  h.delete("host");
  h.delete("connection");
  h.delete("content-length");
  return h;
}

async function handler(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  try {
    if (!BACKEND) {
      return NextResponse.json(
        { ok: false, error: "Missing BACKEND_ORIGIN env var on server" },
        { status: 500 }
      );
    }

    const { path } = await ctx.params;
    const url = new URL(req.url);
    const target = new URL(`${BACKEND}/api/${path.join("/")}`);
    target.search = url.search;

    const method = req.method.toUpperCase();
    const headers = stripBadHeaders(req.headers);

    const body =
      method === "GET" || method === "HEAD" ? undefined : await req.arrayBuffer();

    const upstream = await fetch(target.toString(), {
      method,
      headers,
      body,
      redirect: "manual",
    });

    const contentType = upstream.headers.get("content-type") || "application/json";
    const resBody = await upstream.arrayBuffer();

    if (!upstream.ok) {
      // log exact upstream error to Vercel logs
      let debugText = "";
      try {
        debugText = new TextDecoder().decode(resBody);
      } catch {}
      console.error("[proxy] upstream error", {
        target: target.toString(),
        status: upstream.status,
        body: debugText.slice(0, 2000),
      });
    }

    return new NextResponse(resBody, {
      status: upstream.status,
      headers: { "content-type": contentType },
    });
  } catch (err: any) {
    console.error("[proxy] fatal", err);
    return NextResponse.json(
      { ok: false, error: "Proxy crashed", detail: String(err?.message || err) },
      { status: 502 }
    );
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 200 });
}

export async function GET(req: Request, ctx: any) { return handler(req, ctx); }
export async function POST(req: Request, ctx: any) { return handler(req, ctx); }
export async function PUT(req: Request, ctx: any) { return handler(req, ctx); }
export async function PATCH(req: Request, ctx: any) { return handler(req, ctx); }
export async function DELETE(req: Request, ctx: any) { return handler(req, ctx); }
