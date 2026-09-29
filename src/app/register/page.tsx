import type { Metadata } from "next";
import { AuthFormPlaceholder, ComingSoon } from "@/components/ComingSoon";

export const metadata: Metadata = { title: "Sign up — OFS" };

export default function Page() {
  return (
    <ComingSoon
      title="Sign up"
      description="Create a customer account to start ordering."
    >
      <AuthFormPlaceholder submitLabel="Create account" />
    </ComingSoon>
  );
}
