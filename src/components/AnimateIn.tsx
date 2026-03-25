"use client";
import { useInView } from "@/hooks/useInView";

interface AnimateInProps {
  children: React.ReactNode;
  className?: string;
  delay?: number;
}

export default function AnimateIn({ children, className = "", delay = 0 }: AnimateInProps) {
  const { ref, isInView } = useInView();

  return (
    <div
      ref={ref}
      className={className}
      style={{
        opacity: isInView ? 1 : 0,
        transform: isInView ? "translateY(0)" : "translateY(16px)",
        transition: `opacity 400ms ease-out ${delay}ms, transform 400ms ease-out ${delay}ms`,
      }}
    >
      {children}
    </div>
  );
}
