import { PackageX } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

/** Unknown, retired, or sold-out products. */
export default function NotFound() {
  return (
    <section className="mx-auto w-full max-w-xl px-6 py-20">
      <Card decoration="tape" className="text-center">
        <PackageX aria-hidden strokeWidth={2.5} className="mx-auto h-12 w-12" />
        <h1 className="mt-4 text-4xl">We can&apos;t find that product.</h1>
        <p className="mt-4 text-xl">It may be sold out or no longer carried.</p>
        <Button href="/shop" className="mt-8">
          Back to the shop
        </Button>
      </Card>
    </section>
  );
}
