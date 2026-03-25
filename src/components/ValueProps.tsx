interface ValuePropsDict {
  heading: string;
  ownIt: { title: string; description: string };
  controlIt: { title: string; description: string };
  forgetIt: { title: string; description: string };
}

interface ValuePropsProps {
  dict: ValuePropsDict;
}

export default function ValueProps({ dict }: ValuePropsProps) {
  const valueProps = [
    {
      title: dict.ownIt.title,
      description: dict.ownIt.description,
      icon: (
        <svg
          width="28"
          height="28"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="3" y="11" width="18" height="11" rx="2" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          <path d="M17 7v0a3 3 0 0 0-3-3" />
        </svg>
      ),
    },
    {
      title: dict.controlIt.title,
      description: dict.controlIt.description,
      icon: (
        <svg
          width="28"
          height="28"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="3" />
          <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
        </svg>
      ),
    },
    {
      title: dict.forgetIt.title,
      description: dict.forgetIt.description,
      icon: (
        <svg
          width="28"
          height="28"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polygon points="6,4 20,12 6,20" />
          <path d="M2 19l4-4M2 5l4 4" />
        </svg>
      ),
    },
  ];

  return (
    <section id="value-props" className="py-20">
      <div className="mx-auto max-w-[--content-max-width] px-6">
        <h2 className="mb-12 text-center text-[40px] font-bold leading-tight">
          {dict.heading}
        </h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3 md:gap-6">
          {valueProps.map((prop) => (
            <div
              key={prop.title}
              className="rounded-[14px] border border-[--color-border-default] bg-[--color-bg-secondary] p-6"
            >
              <div className="mb-4 text-[--color-accent]">{prop.icon}</div>
              <h3 className="mb-2 text-xl font-semibold">{prop.title}</h3>
              <p className="text-base text-[--color-text-secondary]">
                {prop.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
