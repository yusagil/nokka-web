import type { Metadata } from "next";
import ApplicationInbox from "@/components/admin/ApplicationInbox";

export const metadata: Metadata = {
  title: "신청함 — Nokka",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

// The admin layout checks the signed-in operator (requireAdminPage) and every admin API call checks
// again. This page holds no data itself; the inbox asks the API from the operator's browser.
export default function ApplicationsPage() {
  return <ApplicationInbox />;
}
