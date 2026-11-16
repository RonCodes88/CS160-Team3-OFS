import { Compass } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

/** Any address that doesn't match a page, including orders the visitor can't see. */
export default function NotFound() {
  return (
    <section className="mx-auto w-full max-w-xl px-6 py-20">
      <Card decoration="tape" className="text-center">
        <Compass aria-hidden strokeWidth={2.5} className="mx-auto h-12 w-12" />
        <h1 className="mt-4 text-4xl">We can&apos;t find that page.</h1>
        <p className="mt-4 text-xl">The link may be mistyped, or the page may have moved.</p>
        <div className="mt-8 flex flex-wrap justify-center gap-4">
          <Button href="/shop">Back to the shop</Button>
          <Button href="/" variant="secondary">
            Home
          </Button>
        </div>
      </Card>
    </section>
  );
}
