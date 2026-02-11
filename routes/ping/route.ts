export const runtime = "nodejs";

export async function GET() {
  return Response.json({ 
    ok: true, 
    ping: true, 
    time: new Date().toISOString() 
  });
}
