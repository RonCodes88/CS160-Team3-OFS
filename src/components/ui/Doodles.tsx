/* Hand-drawn SVG decorations. Purely decorative and hidden on mobile. */

export function SketchArrow({ className = "" }: { className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 120 80"
      fill="none"
      stroke="currentColor"
      strokeWidth={3}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`hidden md:block ${className}`}
    >
      <path d="M8 10 C 40 0, 90 20, 100 62" strokeDasharray="7 7" />
      <path d="M86 54 L 101 66 L 110 48" />
    </svg>
  );
}

export function Squiggle({ className = "" }: { className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 800 40"
      preserveAspectRatio="none"
      fill="none"
      stroke="currentColor"
      strokeWidth={3}
      strokeLinecap="round"
      strokeDasharray="10 8"
      className={`hidden md:block ${className}`}
    >
      <path d="M0 20 Q 50 0 100 20 T 200 20 T 300 20 T 400 20 T 500 20 T 600 20 T 700 20 T 800 20" />
    </svg>
  );
}

/** Corner marks that frame an image placeholder, like crop marks on a sketch. */
export function CornerMarks() {
  const mark = "absolute h-6 w-6 border-pencil";
  return (
    <>
      <span aria-hidden className={`${mark} -left-3 -top-3 border-l-[3px] border-t-[3px]`} />
      <span aria-hidden className={`${mark} -right-3 -top-3 border-r-[3px] border-t-[3px]`} />
      <span aria-hidden className={`${mark} -bottom-3 -left-3 border-b-[3px] border-l-[3px]`} />
      <span aria-hidden className={`${mark} -bottom-3 -right-3 border-b-[3px] border-r-[3px]`} />
    </>
  );
}
