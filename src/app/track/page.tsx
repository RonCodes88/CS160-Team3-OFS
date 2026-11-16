import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { PackageSearch } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { StickyTag } from "@/components/ui/StickyTag";
import { statusLabel } from "@/components/tracking/trackingStatus";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { homeFor } from "@/lib/auth/redirects";
import { formatCents } from "@/lib/cart/format";
import { orderNumber } from "@/lib/notifications/messages";
import { listCustomerOrders } from "@/lib/orders/read";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata: Metadata = { title: "Track My Order — OFS" };

const dateFormat = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "America/Los_Angeles",
});

export default async function Page() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/track");
  if (user.role !== "CUSTOMER") redirect(homeFor(user.role));

  const orders = await listCustomerOrders(createAdminClient(), user.id);

  return (
    <section className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-6 md:py-16">
      <StickyTag>Your orders</StickyTag>
      <h1 className="mt-4 text-4xl md:text-5xl">Track my order</h1>

      {orders.length === 0 ? (
        <Card className="mt-8 text-center">
          <PackageSearch aria-hidden strokeWidth={2.5} className="mx-auto h-12 w-12" />
          <p className="mt-4 text-2xl">You haven&apos;t placed an order yet.</p>
          <Button href="/shop" className="mt-6">
            Start shopping
          </Button>
        </Card>
      ) : (
        <ul className="mt-8 space-y-4">
          {orders.map((order) => (
            <li key={order.id}>
              <Link
                href={`/track/${order.id}`}
                className="flex flex-wrap items-center justify-between gap-3 rounded-wobbly-md border-2 border-pencil bg-white p-4 shadow-soft transition-colors hover:bg-postit"
              >
                <span>
                  <span className="block font-heading text-xl">Order {orderNumber(order.id)}</span>
                  <span className="text-base text-pencil/70">
                    {order.paidAt ? dateFormat.format(new Date(order.paidAt)) : "Not paid"} · {order.itemCount}{" "}
                    {order.itemCount === 1 ? "item" : "items"} · {formatCents(order.totalCents)}
                  </span>
                </span>
                <span className="text-lg">{statusLabel(order.status)} →</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
