import { createApprovalMailHandler } from "@/lib/admin/handlers";

export const runtime = "nodejs";

export const POST = createApprovalMailHandler();
