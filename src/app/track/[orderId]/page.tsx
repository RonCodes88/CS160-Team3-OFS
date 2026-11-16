import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { TrackingView } from "@/components/tracking/TrackingView";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { homeFor } from "@/lib/auth/redirects";
import { STORE_LOCATION } from "@/lib/delivery/store";
import { isUuid } from "@/lib/inventory/validation";
import { getCustomerTracking } from "@/lib/orders/tracking";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata: Metadata = { title: "Track My Order — OFS" };

export default async function Page({ params }: PageProps<"/track/[orderId]">) {
  const { orderId } = await params;
  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=/track/${encodeURIComponent(orderId)}`);
  if (user.role !== "CUSTOMER") redirect(homeFor(user.role));
  if (!isUuid(orderId)) notFound();

  // Another customer's order looks the same as a missing one.
  const result = await getCustomerTracking(createAdminClient(), user.id, orderId.toLowerCase());
  if (!result.ok) notFound();

  return (
    <TrackingView
      initial={result.tracking}
      store={[STORE_LOCATION.lng, STORE_LOCATION.lat]}
      renderedAt={new Date().toISOString()}
    />
  );
}
