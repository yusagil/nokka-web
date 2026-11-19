import { requireAdminPage } from "@/lib/admin/session";

// Every request re-checks the session and the admin's GitHub id; the API checks again on its own.
export default async function ApplicationsLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  await requireAdminPage();
  return children;
}
