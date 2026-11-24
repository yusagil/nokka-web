import { createInstallDownloadHandlers } from "@/lib/update-packages/install-handlers";

// node:crypto and a TCP database connection need the Node.js runtime.
export const runtime = "nodejs";
// Checked against the link, the approval and the package on every request; never prerendered or cached.
export const dynamic = "force-dynamic";
// The same ~35 MB package as the protected download, streamed to a browser.
export const maxDuration = 300;

export const { GET, HEAD } = createInstallDownloadHandlers();
