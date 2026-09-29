import type { ReactNode } from "react";

/** Post-it style label used above section headings. */
export function StickyTag({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={`inline-block -rotate-2 border-2 border-pencil bg-postit px-3 py-1 text-base shadow-hard-sm md:text-lg ${className}`}
    >
      {children}
    </span>
  );
}
