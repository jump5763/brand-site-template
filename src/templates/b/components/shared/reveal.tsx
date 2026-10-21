"use client";

import { useEffect, useRef, type ReactNode } from "react";

type RevealProps = { children: ReactNode; className?: string; delay?: number };

// Fades content in once it first enters the viewport. The `both` fill mode of
// the fade-up animation keeps the element at its start state during the delay,
// which produces the stagger between Reveal siblings.
export function Reveal({ children, className, delay = 0 }: RevealProps) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element || typeof IntersectionObserver === "undefined" ||
        window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    // Keep prerendered content visible when JavaScript or observers are unavailable.
    element.classList.add("opacity-0");
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        element.classList.remove("opacity-0");
        element.classList.add("animate-fade-up");
        observer.disconnect();
      },
      { threshold: 0.1, rootMargin: "0px 0px -10% 0px" },
    );
    observer.observe(element);
    return () => {
      observer.disconnect();
      element.classList.remove("opacity-0", "animate-fade-up");
    };
  }, []);

  return (
    <div
      ref={ref}
      className={className}
      style={delay > 0 ? { animationDelay: `${delay}ms` } : undefined}
    >
      {children}
    </div>
  );
}
