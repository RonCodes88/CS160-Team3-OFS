import type { LucideIcon } from "lucide-react";

const sizes = {
  md: { circle: "h-14 w-14", icon: "h-7 w-7" },
  lg: { circle: "h-20 w-20", icon: "h-9 w-9" },
};

type Props = {
  icon: LucideIcon;
  size?: keyof typeof sizes;
  className?: string;
};

/** A key icon enclosed in a rough, hand-drawn circle. */
export function IconCircle({ icon: Icon, size = "md", className = "bg-white" }: Props) {
  return (
    <span
      className={`inline-flex items-center justify-center rounded-blob border-[3px] border-pencil ${sizes[size].circle} ${className}`}
    >
      <Icon aria-hidden strokeWidth={2.5} className={sizes[size].icon} />
    </span>
  );
}
