import type { Metadata } from "next";
import { ComingSoon } from "@/components/ComingSoon";

export const metadata: Metadata = { title: "Staff Dashboard — OFS" };

export default function Page() {
  return (
    <ComingSoon
      title="Staff Dashboard"
      description="Orders, inventory, and robot trips for employees and managers. Coming soon."
    />
  );
}
