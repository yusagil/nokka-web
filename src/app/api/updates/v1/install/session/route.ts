import { createInstallSessionHandler } from "@/lib/update-packages/install-handlers";

// node:crypto and a TCP database connection need the Node.js runtime.
export const runtime = "nodejs";
// Checked against the link, the approval and the package on every request; never cached.
export const dynamic = "force-dynamic";

export const POST = createInstallSessionHandler();
