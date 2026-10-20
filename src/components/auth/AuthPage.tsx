import type { ReactNode } from "react";
import { Card } from "@/components/ui/Card";

/** Card layout shared by the login and sign-up pages. */
export function AuthPage({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <section className="mx-auto w-full max-w-xl px-4 py-16 sm:px-6 md:py-20">
      <Card decoration="tape" tone="postit" className="-rotate-1">
        <h1 className="text-4xl md:text-5xl">{title}</h1>
        <p className="mt-4 text-xl">{description}</p>
        {children}
      </Card>
    </section>
  );
}
