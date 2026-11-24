import { createApprovalMailRecoveryHandler } from "@/lib/admin/approval-mail-cron";

// node:crypto and a TCP database connection need the Node.js runtime.
export const runtime = "nodejs";
// As the digest: the handler starts no attempt it can not finish within 50 seconds (see approval-mail-cron.ts).
export const maxDuration = 60;

export const GET = createApprovalMailRecoveryHandler();
