import { createApplicationDigestHandler } from "@/lib/notifications/handler";

// node:crypto and a TCP database connection need the Node.js runtime.
export const runtime = "nodejs";
// One claim, up to three token requests and a single send, and the record; well inside the 5-minute lease.
export const maxDuration = 60;

export const GET = createApplicationDigestHandler();
