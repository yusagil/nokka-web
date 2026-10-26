import Image from "next/image";

interface ScreenshotProps {
  src: string;
  alt: string;
  /** Intrinsic pixel size of the 2x render. */
  width: number;
  height: number;
  caption?: string;
  priority?: boolean;
  /** Rendered width hint for responsive srcset. */
  sizes?: string;
  className?: string;
}

/** An app render in a light macOS-style frame, so it reads as a window on the dark page. */
export default function Screenshot({
  src,
  alt,
  width,
  height,
  caption,
  priority = false,
  sizes = "(min-width: 1024px) 560px, 100vw",
  className = "",
}: ScreenshotProps) {
  const image = (
    <div className="overflow-hidden rounded-[14px] border border-white/10 bg-[#f1f1f1] shadow-[0_8px_32px_rgba(0,0,0,0.5)]">
      <Image
        src={src}
        alt={alt}
        width={width}
        height={height}
        sizes={sizes}
        priority={priority}
        className="block h-auto w-full"
      />
    </div>
  );

  if (!caption) return <div className={className}>{image}</div>;

  return (
    <figure className={className}>
      {image}
      <figcaption className="mt-3 text-sm leading-relaxed text-fg-subtle">{caption}</figcaption>
    </figure>
  );
}
