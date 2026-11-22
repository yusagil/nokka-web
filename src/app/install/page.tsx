import InstallLinkPage from "@/components/install/InstallLinkPage";

// Static: the link's secret is in the URL fragment, which only the browser sees.
export default function Page() {
  return <InstallLinkPage />;
}
