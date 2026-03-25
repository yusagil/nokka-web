interface TrustBadgesProps {
  dict: {
    badges: string[];
  };
}

export default function TrustBadges({ dict }: TrustBadgesProps) {
  return (
    <section className="py-12 px-4">
      <div className="mx-auto flex max-w-[1120px] flex-wrap justify-center gap-3">
        {dict.badges.map((badge) => (
          <span
            key={badge}
            className="rounded-full border border-[--color-border-default] bg-[--color-bg-secondary] px-4 py-2 text-xs text-[--color-text-secondary]"
          >
            {badge}
          </span>
        ))}
      </div>
    </section>
  );
}
