import type { Metadata } from "next";
import { ComingSoon } from "@/components/ComingSoon";

export const metadata: Metadata = { title: "Track My Order — OFS" };

export default function Page() {
  return (
    <ComingSoon
      title="Track My Order"
      description="Follow your robot on a live map from the store to your door. Coming soon."
    />
  );
}
