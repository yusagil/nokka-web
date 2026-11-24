import { createInstallLinkHandlers } from "@/lib/admin/handlers";

export const runtime = "nodejs";

export const { POST, DELETE } = createInstallLinkHandlers();
