import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { StaffDashboard } from "@/components/staff/StaffDashboard";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { getCatalogCategories } from "@/lib/catalog/service";
import type { CatalogCategory } from "@/lib/catalog/types";

export const metadata: Metadata = { title: "Staff Dashboard — OFS" };

export default async function Page() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/staff");

  if (user.role !== "EMPLOYEE" && user.role !== "MANAGER") {
    return (
      <section className="mx-auto w-full max-w-xl px-4 py-16 sm:px-6 md:py-20">
        <Card decoration="tape" tone="postit" className="-rotate-1">
          <h1 className="text-4xl md:text-5xl">Staff only</h1>
          <p className="mt-4 text-xl">
            This page is for store employees and managers. You&apos;re signed in as {user.email}.
          </p>
          <div className="mt-8">
            <Button href="/">Back home</Button>
          </div>
        </Card>
      </section>
    );
  }

  // Category names label the list and fill the product form. Without them the
  // dashboard still works, so a failed lookup is logged rather than fatal.
  let categories: CatalogCategory[] = [];
  try {
    categories = await getCatalogCategories();
  } catch (err) {
    console.error(err);
  }

  return <StaffDashboard role={user.role} email={user.email} categories={categories} />;
}
