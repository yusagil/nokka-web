import { DOWNLOAD_URL } from "@/lib/links";

interface DownloadButtonProps {
  label: string;
  /** File type and size, read by screen readers after the label. */
  hint: string;
  size?: "md" | "lg";
}

export default function DownloadButton({ label, hint, size = "md" }: DownloadButtonProps) {
  const sizing = size === "lg" ? "h-14 px-8 text-lg" : "h-12 px-7 text-base";

  return (
    <a
      href={DOWNLOAD_URL}
      className={`inline-flex items-center justify-center gap-2 rounded-full bg-accent-strong font-medium text-white shadow-sm transition duration-150 ease-out hover:scale-[1.02] hover:bg-accent-stronger active:scale-[0.98] ${sizing}`}
    >
      <svg
        width="20"
        height="20"
        viewBox="0 0 20 20"
        fill="none"
        aria-hidden="true"
        className="shrink-0"
      >
        <path
          d="M10 3v10m0 0-3.5-3.5M10 13l3.5-3.5M4 17h12"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {label}
      <span className="sr-only"> {hint}</span>
    </a>
  );
}
