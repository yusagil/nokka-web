interface FeatureDict {
  title: string;
  description: string;
}

interface FeaturesGridProps {
  dict: {
    heading: string;
    features: {
      systemAudio: FeatureDict;
      pauseResume: FeatureDict;
      globalShortcuts: FeatureDict;
      menuBarApp: FeatureDict;
      floatingControlBar: FeatureDict;
      countdownTimer: FeatureDict;
      h264: FeatureDict;
      macosNative: FeatureDict;
    };
  };
}

export default function FeaturesGrid({ dict }: FeaturesGridProps) {
  const features = [
    {
      ...dict.features.systemAudio,
      icon: (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
          <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
          <line x1="12" y1="19" x2="12" y2="23" />
          <line x1="8" y1="23" x2="16" y2="23" />
        </svg>
      ),
    },
    {
      ...dict.features.pauseResume,
      icon: (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="6" y="4" width="4" height="16" rx="1" />
          <rect x="14" y="4" width="4" height="16" rx="1" />
        </svg>
      ),
    },
    {
      ...dict.features.globalShortcuts,
      icon: (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 3a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3 3 3 0 0 0 3-3 3 3 0 0 0-3-3H6a3 3 0 0 0-3 3 3 3 0 0 0 3 3 3 3 0 0 0 3-3V6a3 3 0 0 0-3-3 3 3 0 0 0-3 3 3 3 0 0 0 3 3h12a3 3 0 0 0 3-3 3 3 0 0 0-3-3z" />
        </svg>
      ),
    },
    {
      ...dict.features.menuBarApp,
      icon: (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="3" width="20" height="4" rx="1" />
          <circle cx="12" cy="5" r="1" fill="currentColor" />
          <path d="M4 7v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7" />
        </svg>
      ),
    },
    {
      ...dict.features.floatingControlBar,
      icon: (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="9" width="18" height="6" rx="3" />
          <circle cx="8" cy="12" r="1.5" fill="currentColor" />
          <circle cx="12" cy="12" r="1.5" fill="currentColor" />
        </svg>
      ),
    },
    {
      ...dict.features.countdownTimer,
      icon: (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="13" r="9" />
          <polyline points="12,9 12,13 15,15" />
          <path d="M9 1h6M12 1v3" />
        </svg>
      ),
    },
    {
      ...dict.features.h264,
      icon: (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="4" y="4" width="16" height="16" rx="2" />
          <path d="M9 9h6v6H9z" />
          <path d="M4 9h2M4 15h2M18 9h2M18 15h2M9 4v2M15 4v2M9 18v2M15 18v2" />
        </svg>
      ),
    },
    {
      ...dict.features.macosNative,
      icon: (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 2C8 2 4 6 4 10c0 6 8 12 8 12s8-6 8-12c0-4-4-8-8-8z" />
          <path d="M12 2c2 2 3 4 3 6s-1 4-3 6c-2-2-3-4-3-6s1-4 3-6z" />
        </svg>
      ),
    },
  ];

  return (
    <section id="features" className="py-20">
      <div className="mx-auto max-w-[--content-max-width] px-6">
        <h2 className="mb-12 text-center text-[40px] font-bold leading-tight">
          {dict.heading}
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {features.map((feature) => (
            <div
              key={feature.title}
              className="rounded-[10px] border border-[--color-border-default] bg-[--color-bg-secondary] p-5"
            >
              <div className="mb-3 text-[--color-accent]">{feature.icon}</div>
              <h3 className="mb-1.5 text-base font-semibold">
                {feature.title}
              </h3>
              <p className="text-sm text-[--color-text-secondary]">
                {feature.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
