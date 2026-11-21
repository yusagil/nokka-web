import { createPackageHandlers } from "@/lib/update-packages/handlers";

// node:crypto and a TCP database connection need the Node.js runtime.
export const runtime = "nodejs";
// Checked against the registration on every request; never prerendered or cached.
export const dynamic = "force-dynamic";
// A ~32 MB package streamed to a slow connection. Allowed on every plan with Fluid compute (the
// default); a deployment without it fails the build here rather than cutting downloads short.
export const maxDuration = 300;

export const { GET, HEAD } = createPackageHandlers();
