"use client";

import { useState } from "react";
import { StickyTag } from "@/components/ui/StickyTag";
import type { CatalogCategory } from "@/lib/catalog/types";
import { AuditLogPanel } from "./AuditLogPanel";
import { InventoryPanel } from "./InventoryPanel";

export type StaffRole = "EMPLOYEE" | "MANAGER";

type Tab = "inventory" | "low" | "retired" | "audit";

const TABS: { id: Tab; label: string; managerOnly: boolean }[] = [
  { id: "inventory", label: "Inventory", managerOnly: false },
  { id: "low", label: "Low stock", managerOnly: false },
  { id: "retired", label: "Retired", managerOnly: true },
  { id: "audit", label: "Audit log", managerOnly: true },
];

type Props = {
  role: StaffRole;
  email: string;
  categories: readonly CatalogCategory[];
};

/**
 * Employees manage stock; managers also create, edit, and retire products and
 * read the audit log. The APIs enforce the same split on every request.
 */
export function StaffDashboard({ role, email, categories }: Props) {
  const isManager = role === "MANAGER";
  const tabs = TABS.filter((t) => isManager || !t.managerOnly);
  const [tab, setTab] = useState<Tab>("inventory");
  const categoryNames = Object.fromEntries(categories.map((c) => [c.id, c.name]));

  return (
    <section className="mx-auto w-full max-w-5xl px-4 py-12 sm:px-6 md:py-16">
      <StickyTag>{isManager ? "Manager" : "Employee"}</StickyTag>
      <h1 className="mt-4 text-4xl md:text-5xl">Staff dashboard</h1>
      <p className="mt-2 text-xl">
        Signed in as {email}.{" "}
        {isManager
          ? "Update stock, manage products, and review every change."
          : "Keep stock counts accurate for the storefront."}
      </p>

      <div role="tablist" aria-label="Dashboard sections" className="mt-8 flex flex-wrap gap-2">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`panel-${t.id}`}
            onClick={() => setTab(t.id)}
            className={`rounded-wobbly border-2 border-pencil px-4 py-1 text-lg shadow-hard-sm transition-colors ${tab === t.id ? "bg-pencil text-white" : "bg-white hover:bg-postit"}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === "audit" && isManager ? (
          <AuditLogPanel categoryNames={categoryNames} />
        ) : (
          <InventoryPanel
            // A separate instance per tab so search and paging don't leak between them.
            key={tab}
            mode={tab === "low" ? "low" : tab === "retired" && isManager ? "retired" : "all"}
            canManage={isManager}
            categories={categories}
          />
        )}
      </div>
    </section>
  );
}
