"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

/** Catches an unexpected failure on any page that has no closer error boundary. */
export default function Error({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <section className="mx-auto w-full max-w-xl px-6 py-20">
      <Card decoration="tape">
        <div role="alert">
          <h1 className="text-4xl">Something went wrong.</h1>
          <p className="mt-4 text-xl">This page couldn&apos;t load. Nothing was charged or changed. Please try again.</p>
        </div>
        <div className="mt-8 flex flex-wrap gap-4">
          <Button onClick={() => retry()}>Try again</Button>
          <Button href="/shop" variant="secondary">
            Back to the shop
          </Button>
        </div>
      </Card>
    </section>
  );
}
