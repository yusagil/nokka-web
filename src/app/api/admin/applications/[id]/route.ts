import { createUpdateHandler } from "@/lib/admin/handlers";

export const runtime = "nodejs";

export const PATCH = createUpdateHandler();
