interface ComparisonItem {
  name: string;
  description: string;
}

interface ComparisonProps {
  dict: {
    heading: string;
    items: {
      loom: ComparisonItem;
      obs: ComparisonItem;
      quicktime: ComparisonItem;
      builtIn: ComparisonItem;
    };
  };
}

export default function Comparison({ dict }: ComparisonProps) {
  const comparisons = [
    dict.items.loom,
    dict.items.obs,
    dict.items.quicktime,
    dict.items.builtIn,
  ];

  return (
    <section className="py-20 px-4">
      <div className="mx-auto max-w-[1120px]">
        <h2 className="mb-12 text-3xl font-bold text-[--color-text-primary]">
          {dict.heading}
        </h2>

        <div className="space-y-0">
          {comparisons.map((item, i) => (
            <div
              key={item.name}
              className={`py-8 ${
                i < comparisons.length - 1
                  ? "border-b border-[--color-border-subtle]"
                  : ""
              }`}
            >
              <h3 className="mb-3 text-lg font-semibold text-[--color-text-primary]">
                {item.name}
              </h3>
              <p className="max-w-prose text-[--color-text-secondary] leading-relaxed">
                {item.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
