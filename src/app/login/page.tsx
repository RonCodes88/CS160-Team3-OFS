import type { Metadata } from "next";
import { AuthFormPlaceholder, ComingSoon } from "@/components/ComingSoon";

export const metadata: Metadata = { title: "Log in — OFS" };

export default function Page() {
  return (
    <ComingSoon
      title="Log in"
      description="Welcome back! Log in to shop and track your orders."
    >
      <AuthFormPlaceholder submitLabel="Log in" />
    </ComingSoon>
  );
}
