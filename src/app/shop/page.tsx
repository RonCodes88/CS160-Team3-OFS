import type { Metadata } from "next";
import { ComingSoon } from "@/components/ComingSoon";

export const metadata: Metadata = { title: "Shop — OFS" };

export default function Page() {
  return (
    <ComingSoon
      title="Shop"
      description="Browse the aisles, fill your cart, and watch the weight meter. The storefront is coming soon."
    />
  );
}
