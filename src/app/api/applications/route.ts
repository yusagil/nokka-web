import { createApplicationsHandler } from "@/lib/applications/handler";

// node:crypto and a TCP database connection need the Node.js runtime.
export const runtime = "nodejs";

export const POST = createApplicationsHandler();
