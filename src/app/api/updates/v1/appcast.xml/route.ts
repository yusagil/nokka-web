import { createAppcastHandlers } from "@/lib/update-packages/handlers";

// node:crypto and a TCP database connection need the Node.js runtime.
export const runtime = "nodejs";
// Checked against the registration on every request; never prerendered or cached.
export const dynamic = "force-dynamic";

export const { GET, HEAD } = createAppcastHandlers();
