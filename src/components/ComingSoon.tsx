import type { ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { StickyTag } from "@/components/ui/StickyTag";

type Props = {
  title: string;
  description: string;
  children?: ReactNode;
};

/** Placeholder page for features that are not built yet. */
export function ComingSoon({ title, description, children }: Props) {
  return (
    <section className="mx-auto w-full max-w-xl px-6 py-20">
      <Card decoration="tape" tone="postit" className="-rotate-1">
        <StickyTag className="bg-white">Under construction ✏️</StickyTag>
        <h1 className="mt-4 text-4xl md:text-5xl">{title}</h1>
        <p className="mt-4 text-xl">{description}</p>
        {children}
        <div className="mt-8">
          <Button href="/">Back home</Button>
        </div>
      </Card>
    </section>
  );
}

const inputClass =
  "h-12 w-full rounded-wobbly border-2 border-pencil bg-white px-4 text-lg placeholder:text-pencil/40 focus:border-pen focus:outline-none focus:ring-2 focus:ring-pen/20 disabled:opacity-60";

/** Visual-only auth form. Inputs are disabled until auth is implemented. */
export function AuthFormPlaceholder({ submitLabel }: { submitLabel: string }) {
  return (
    <form className="mt-6 space-y-4" aria-describedby="auth-note">
      <label className="block">
        <span className="text-lg">Email</span>
        <input type="email" disabled placeholder="you@example.com" className={inputClass} />
      </label>
      <label className="block">
        <span className="text-lg">Password</span>
        <input type="password" disabled placeholder="••••••••" className={inputClass} />
      </label>
      <Button type="submit" disabled variant="secondary" className="w-full">
        {submitLabel}
      </Button>
      <p id="auth-note" className="text-base text-pencil/70">
        Auth isn&apos;t wired up yet. This form is a placeholder.
      </p>
    </form>
  );
}
