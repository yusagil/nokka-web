import { createRegistrationHandler } from "@/lib/updates/registration/handlers";

// node:crypto and a TCP database connection need the Node.js runtime.
export const runtime = "nodejs";

export const POST = createRegistrationHandler();
