import { copy } from "@/components/admin/copy";

export default function Loading() {
  return (
    <div className="mx-auto max-w-[880px] px-4 py-10 md:px-8 md:py-14">
      <p role="status" className="text-fg-muted">
        {copy.pageLoading}
      </p>
    </div>
  );
}
