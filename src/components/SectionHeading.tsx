interface SectionHeadingProps {
  id: string;
  eyebrow: string;
  heading: string;
  intro?: string;
  align?: "left" | "center";
}

export default function SectionHeading({
  id,
  eyebrow,
  heading,
  intro,
  align = "left",
}: SectionHeadingProps) {
  const centered = align === "center";

  return (
    <div className={centered ? "mx-auto max-w-[680px] text-center" : "max-w-[680px]"}>
      <p className="text-sm font-medium tracking-wide text-accent-text">{eyebrow}</p>
      <h2
        id={id}
        className="mt-3 text-balance text-[28px] font-bold leading-[1.2] tracking-[-0.02em] text-fg md:text-[40px] md:leading-[1.15]"
      >
        {heading}
      </h2>
      {intro && <p className="mt-4 text-pretty text-lg leading-relaxed text-fg-muted">{intro}</p>}
    </div>
  );
}
