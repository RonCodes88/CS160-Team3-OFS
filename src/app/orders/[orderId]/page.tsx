import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { CircleCheck, MapPin } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { StickyTag } from "@/components/ui/StickyTag";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { homeFor } from "@/lib/auth/redirects";
import { formatCents, formatWeight } from "@/lib/cart/format";
import { isUuid } from "@/lib/inventory/validation";
import { getCustomerOrder } from "@/lib/orders/read";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata: Metadata = { title: "Order confirmed — OFS" };

const STATUS_LABELS: Record<string, string> = {
  PAID: "Paid, waiting for a robot",
  PREPARING: "Being packed",
  BATCHED: "Assigned to a robot",
  OUT_FOR_DELIVERY: "Out for delivery",
  DELIVERED: "Delivered",
  CANCELED: "Canceled",
};

type AddressSnapshot = { line_1?: string; line_2?: string | null; city?: string; state?: string; postal_code?: string };

export default async function Page({ params }: PageProps<"/orders/[orderId]">) {
  const { orderId } = await params;
  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=/orders/${encodeURIComponent(orderId)}`);
  if (user.role !== "CUSTOMER") redirect(homeFor(user.role));
  if (!isUuid(orderId)) notFound();

  // Only the signed-in customer's own orders; anyone else's looks missing.
  const order = await getCustomerOrder(createAdminClient(), user.id, orderId.toLowerCase());
  if (!order) notFound();

  const address = order.deliveryAddress as AddressSnapshot;
  const street = [address.line_1, address.line_2].filter(Boolean).join(" ");

  return (
    <section className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-6 md:py-16">
      <StickyTag>Order placed</StickyTag>
      <h1 className="mt-4 flex items-center gap-3 text-4xl md:text-5xl">
        <CircleCheck aria-hidden strokeWidth={2.5} className="h-10 w-10 shrink-0 text-pen" />
        Thanks! Your order is confirmed.
      </h1>
      <p className="mt-3 text-lg text-pencil/70">
        Order <span className="font-mono text-base">{order.id}</span>. Your receipt is shown below.
      </p>

      <div className="mt-8 space-y-8">
        <Card decoration="tape">
          <h2 className="text-3xl">Delivery</h2>
          <p className="mt-4 flex items-start gap-3 text-xl">
            <MapPin aria-hidden strokeWidth={2.5} className="mt-1 h-6 w-6 shrink-0" />
            <span>{street}, {address.city}, {address.state} {address.postal_code}</span>
          </p>
          <p className="mt-3 text-lg">
            Status: <span className="font-heading">{STATUS_LABELS[order.status] ?? order.status}</span>
          </p>
        </Card>

        <Card>
          <h2 className="text-3xl">Summary</h2>
          <ul className="mt-6 divide-y-2 divide-dashed divide-pencil/30 text-lg">
            {order.items.map((item, index) => (
              <li key={index} className="flex justify-between gap-4 py-2">
                <span>
                  {item.productName} <span className="text-pencil/70">× {item.quantity}</span>
                </span>
                <span className="tabular-nums">{formatCents(item.unitPriceCents * item.quantity)}</span>
              </li>
            ))}
          </ul>
          <dl className="mt-6 space-y-2 text-xl">
            <Row label="Subtotal" value={formatCents(order.subtotalCents)} />
            <Row label="Total weight" value={formatWeight(order.totalWeight)} />
            <Row label="Delivery" value={order.deliveryFeeCents === 0 ? "Free" : formatCents(order.deliveryFeeCents)} />
            <Row label="Demo tax (5%)" value={formatCents(order.taxCents)} />
            <div className="flex justify-between border-t-2 border-dashed border-pencil pt-3 font-heading text-2xl">
              <dt>Total paid</dt>
              <dd className="tabular-nums">{formatCents(order.totalCents)}</dd>
            </div>
          </dl>
        </Card>

        <div className="flex flex-wrap gap-4">
          <Button href="/track">Track my order</Button>
          <Button href="/shop" variant="secondary">Keep shopping</Button>
        </div>
      </div>
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <dt>{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}
