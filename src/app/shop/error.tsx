"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

export default function Error({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <section className="mx-auto w-full max-w-xl px-6 py-20">
      <Card decoration="tape">
        <div role="alert">
          <h1 className="text-4xl">We couldn&apos;t load the shop.</h1>
          <p className="mt-4 text-xl">Something went wrong fetching products. Please try again.</p>
        </div>
        <Button className="mt-8" onClick={() => retry()}>
          Try again
        </Button>
      </Card>
    </section>
  );
}
