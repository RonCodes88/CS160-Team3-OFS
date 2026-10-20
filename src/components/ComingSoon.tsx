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
