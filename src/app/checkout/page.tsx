import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CheckoutView } from "@/components/checkout/CheckoutView";
import { listAddresses } from "@/lib/auth/addresses";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { homeFor } from "@/lib/auth/redirects";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata: Metadata = { title: "Checkout — OFS" };

export default async function Page() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/checkout");
  if (user.role !== "CUSTOMER") redirect(homeFor(user.role));

  // Same data as GET /api/addresses, read directly so the server doesn't make
  // an HTTP request to itself.
  const addresses = await listAddresses(createAdminClient(), user.id);
  return (
    <CheckoutView
      initialAddresses={addresses}
      publishableKey={process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? ""}
    />
  );
}
