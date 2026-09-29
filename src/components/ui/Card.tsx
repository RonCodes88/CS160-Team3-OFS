import type { ReactNode } from "react";

type Props = {
  children: ReactNode;
  decoration?: "tape" | "tack";
  tone?: "white" | "postit";
  className?: string;
};

const tones = {
  white: "bg-white",
  postit: "bg-postit",
};

export function Card({ children, decoration, tone = "white", className = "" }: Props) {
  return (
    <div
      className={`relative rounded-wobbly-md border-2 border-pencil p-6 shadow-soft md:p-8 ${tones[tone]} ${className}`}
    >
      {decoration === "tape" && (
        <span
          aria-hidden
          className="absolute -top-3 left-1/2 h-6 w-24 -translate-x-1/2 -rotate-2 bg-pencil/15"
        />
      )}
      {decoration === "tack" && (
        <span
          aria-hidden
          className="absolute -top-3 left-1/2 h-6 w-6 -translate-x-1/2 rounded-full border-2 border-pencil bg-marker shadow-hard-sm"
        />
      )}
      {children}
    </div>
  );
}
