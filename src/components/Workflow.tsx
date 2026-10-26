import type { ReactNode } from "react";
import type { Dictionary } from "@/dictionaries";
import MinutesExample from "./MinutesExample";
import Screenshot from "./Screenshot";
import SectionHeading from "./SectionHeading";

interface WorkflowProps {
  dict: Dictionary["how"];
}

interface StepProps {
  index: number;
  label: string;
  title: string;
  description: string;
  points: string[];
  media: ReactNode;
}

function Step({ index, label, title, description, points, media }: StepProps) {
  const number = String(index + 1).padStart(2, "0");
  const flipped = index % 2 === 1;

  return (
    <li className="reveal grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
      <div className={flipped ? "lg:order-2" : undefined}>
        <p className="flex items-center gap-3 text-sm font-medium text-accent-text">
          <span className="font-mono">{number}</span>
          <span aria-hidden="true" className="h-px w-6 bg-line" />
          {label}
        </p>
        <h3 className="mt-3 text-[24px] font-semibold leading-[1.25] tracking-[-0.02em] text-fg md:text-[28px]">
          {title}
        </h3>
        <p className="mt-4 leading-relaxed text-fg-muted">{description}</p>
        <ul className="mt-6 space-y-3">
          {points.map((point) => (
            <li key={point} className="flex gap-3 text-[15px] leading-relaxed text-fg-muted">
              <span aria-hidden="true" className="mt-[9px] h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
              <span>{point}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className={`flex flex-col items-center gap-6 ${flipped ? "lg:order-1" : ""}`}>{media}</div>
    </li>
  );
}

export default function Workflow({ dict }: WorkflowProps) {
  const { record, transcribe, minutes } = dict.steps;

  const steps: Omit<StepProps, "index">[] = [
    {
      ...record,
      media: (
        <>
          <Screenshot
            src="/screens/main-window-recording.png"
            alt={record.imageAlt}
            width={760}
            height={740}
            caption={record.imageCaption}
            sizes="(min-width: 1024px) 380px, 90vw"
            className="w-full max-w-[380px]"
          />
          <Screenshot
            src="/screens/floating-bar.png"
            alt={record.barAlt}
            width={800}
            height={72}
            caption={record.barCaption}
            sizes="(min-width: 1024px) 400px, 90vw"
            className="w-full max-w-[400px]"
          />
        </>
      ),
    },
    {
      ...transcribe,
      media: (
        <Screenshot
          src="/screens/speaker-names.png"
          alt={transcribe.imageAlt}
          width={760}
          height={354}
          sizes="(min-width: 1024px) 480px, 90vw"
          className="w-full max-w-[480px]"
        />
      ),
    },
    {
      ...minutes,
      media: <MinutesExample dict={minutes.example} />,
    },
  ];

  return (
    <section id="how" aria-labelledby="how-heading" className="px-4 py-20 md:px-8 md:py-28">
      <div className="mx-auto max-w-content">
        <SectionHeading
          id="how-heading"
          eyebrow={dict.eyebrow}
          heading={dict.heading}
          intro={dict.intro}
        />
        <ol className="mt-16 space-y-24 md:mt-20 md:space-y-32">
          {steps.map((step, i) => (
            <Step key={step.label} index={i} {...step} />
          ))}
        </ol>
      </div>
    </section>
  );
}
