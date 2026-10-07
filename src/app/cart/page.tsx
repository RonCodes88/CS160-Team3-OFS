import type { Metadata } from "next";
import { CartView } from "@/components/cart/CartView";

export const metadata: Metadata = { title: "Cart — OFS" };

export default function Page() {
  return <CartView />;
}
