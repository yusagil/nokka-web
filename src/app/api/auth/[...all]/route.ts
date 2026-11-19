import { getAuth } from "@/lib/admin/better-auth";

// Better Auth needs node:crypto and a pg connection.
export const runtime = "nodejs";

async function handle(request: Request): Promise<Response> {
  const configured = getAuth();
  if (!configured) {
    return Response.json(
      { ok: false, code: "UNAVAILABLE" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
  const response = await configured.auth.handler(request);
  // Copy so headers are mutable even for redirect responses.
  const copy = new Response(response.body, response);
  copy.headers.set("Cache-Control", "no-store");
  return copy;
}

export const GET = handle;
export const POST = handle;
