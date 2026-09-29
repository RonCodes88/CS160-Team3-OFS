import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

type Variant = "primary" | "secondary";

const base =
  "inline-flex h-12 items-center justify-center gap-2 rounded-wobbly border-[3px] border-pencil px-6 text-lg md:text-xl shadow-hard transition-all duration-100 " +
  "hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-hard-sm " +
  "active:translate-x-[4px] active:translate-y-[4px] active:shadow-none " +
  "disabled:pointer-events-none disabled:opacity-50";

const variants: Record<Variant, string> = {
  primary: "bg-white text-pencil hover:bg-marker hover:text-white",
  secondary: "bg-muted text-pencil hover:bg-pen hover:text-white",
};

type Props = {
  variant?: Variant;
  className?: string;
  children: ReactNode;
} & (
  | ({ href: string } & Omit<ComponentProps<typeof Link>, "href" | "className">)
  | ({ href?: undefined } & Omit<ComponentProps<"button">, "className">)
);

export function Button({ variant = "primary", className = "", ...props }: Props) {
  const classes = `${base} ${variants[variant]} ${className}`;
  if (props.href !== undefined) {
    return <Link {...props} className={classes} />;
  }
  const { type = "button", ...rest } = props;
  return <button type={type} {...rest} className={classes} />;
}
