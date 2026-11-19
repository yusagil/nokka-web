"use client"; // Error boundaries must be Client Components

import { copy } from "@/components/admin/copy";

// The error isn't logged or shown: it could carry request details, and the operator only needs a retry.
export default function InboxError({ unstable_retry }: { unstable_retry: () => void }) {
  return (
    <div className="mx-auto max-w-[880px] px-4 py-10 md:px-8 md:py-14">
      <h1 className="text-[28px] font-bold tracking-[-0.02em] text-fg md:text-[32px]">{copy.title}</h1>
      <div role="alert" className="mt-6 rounded-[10px] border border-accent/40 p-4 text-sm text-accent-text">
        <p>{copy.pageFailed}</p>
        <button
          type="button"
          onClick={() => unstable_retry()}
          className="mt-3 inline-flex min-h-11 items-center rounded-full border border-line px-4 font-medium text-fg hover:bg-surface-2"
        >
          {copy.retry}
        </button>
      </div>
    </div>
  );
}
