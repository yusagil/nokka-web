import { createChallengeHandler } from "@/lib/updates/registration/handlers";

// node:crypto and a TCP database connection need the Node.js runtime.
export const runtime = "nodejs";
// Rate limit, mail access, one transaction and at most one send, padded to a common response time.
export const maxDuration = 30;

export const POST = createChallengeHandler();
