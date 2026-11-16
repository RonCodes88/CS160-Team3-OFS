"use client";

import { useEffect, useState, type FormEvent } from "react";
import { ArchiveRestore, PackageSearch, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import type { CatalogCategory } from "@/lib/catalog/types";
import { DEFAULT_LOW_STOCK_THRESHOLD, MAX_SEARCH_LENGTH } from "@/lib/inventory/validation";
import { reactivate, retire, saveStock, submitProduct, withItem, withoutItem } from "./inventoryActions";
import { InventoryRow } from "./InventoryRow";
import { Notice, type NoticeValue } from "./Notice";
import { ProductForm } from "./ProductForm";
import { parseThreshold, type ProductFormValues } from "./productInput";
import { fetchInventory, fetchLowStock, PAGE_SIZE, type InventoryItem, type InventoryPage } from "./staffApi";
import { inputClass, smallButton } from "./styles";

type Props = {
  /**
   * "all" lists every active product with search; "low" lists stock at or
   * under a threshold; "retired" lists retired products a manager can bring back.
   */
  mode: "all" | "low" | "retired";
  canManage: boolean;
  categories: readonly CatalogCategory[];
};

type FormState = { editing: InventoryItem | null } | null;

/** Inventory list with stock editing, plus the product forms for managers. */
export function InventoryPanel({ mode, canManage, categories }: Props) {
  const [search, setSearch] = useState("");
  const [threshold, setThreshold] = useState(DEFAULT_LOW_STOCK_THRESHOLD);
  const [offset, setOffset] = useState(0);
  const [reloadKey, setReloadKey] = useState(0);
  const [page, setPage] = useState<InventoryPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<NoticeValue>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(null);
  const categoryNames = Object.fromEntries(categories.map((c) => [c.id, c.name]));

  useEffect(() => {
    let cancelled = false;
    const request = mode === "low" ? fetchLowStock(threshold, offset) : fetchInventory(search, offset, mode === "retired");
    void request.then((result) => {
      if (cancelled) return;
      if (result.ok) setPage(result.data);
      else setNotice({ kind: "error", text: result.message });
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [mode, search, threshold, offset, reloadKey]);

  function reload(changes: () => void) {
    setLoading(true);
    changes();
  }

  function onSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    reload(() => {
      if (mode === "low") {
        setThreshold(parseThreshold(String(data.get("threshold") ?? "")));
      } else {
        setSearch(String(data.get("q") ?? ""));
      }
      setOffset(0);
      setReloadKey((k) => k + 1);
    });
  }

  async function onSaveQuantity(item: InventoryItem, quantity: number) {
    setBusyId(item.productId);
    const result = await saveStock(item, quantity);
    setBusyId(null);
    const saved = result.item;
    if (saved) setPage((p) => withItem(p, saved));
    // A refused save means the count on screen is out of date: show the real one.
    else reload(() => setReloadKey((k) => k + 1));
    setNotice(result.notice);
  }

  async function onReactivate(item: InventoryItem) {
    setBusyId(item.productId);
    const result = await reactivate(item);
    setBusyId(null);
    if (result.reactivated) setPage((p) => withoutItem(p, item.productId));
    setNotice(result.notice);
  }

  async function onRetire(item: InventoryItem) {
    setBusyId(item.productId);
    const result = await retire(item);
    setBusyId(null);
    if (result.retired) setPage((p) => withoutItem(p, item.productId));
    setNotice(result.notice);
  }

  async function onSubmitProduct(values: ProductFormValues): Promise<string | null> {
    const result = await submitProduct(values, form?.editing ?? null);
    if (!result.ok) return result.message;
    if (result.created) reload(() => setReloadKey((k) => k + 1));
    else setPage((p) => withItem(p, result.item));
    setNotice(result.notice);
    setForm(null);
    return null;
  }

  const items = page?.items ?? [];

  return (
    <div>
      <div className="mt-6 flex flex-wrap items-end gap-3">
        <form onSubmit={onSearch} role="search" className="flex min-w-64 flex-1 gap-2">
          {mode === "low" ? (
            <label className="flex items-center gap-2 text-lg">
              Stock at or under
              <input
                name="threshold"
                inputMode="numeric"
                defaultValue={threshold}
                className={`${inputClass} w-24 text-right`}
              />
            </label>
          ) : (
            <>
              <label htmlFor="inventory-search" className="sr-only">
                Search by name or SKU
              </label>
              <input
                id="inventory-search"
                type="search"
                name="q"
                defaultValue={search}
                maxLength={MAX_SEARCH_LENGTH}
                placeholder="Search by name or SKU"
                className={`${inputClass} min-w-0 flex-1`}
              />
            </>
          )}
          <button type="submit" className={`${smallButton} h-11`}>
            <Search aria-hidden strokeWidth={3} className="h-4 w-4" />
            {mode === "low" ? "Show" : "Search"}
          </button>
        </form>
        {canManage && mode === "all" && !form && (
          <Button onClick={() => setForm({ editing: null })}>
            <Plus aria-hidden strokeWidth={3} className="h-5 w-5" />
            New product
          </Button>
        )}
      </div>

      <Notice notice={notice} onDismiss={() => setNotice(null)} />

      {canManage && form && (
        <ProductForm
          key={form.editing?.productId ?? "new"}
          categories={categories}
          editing={form.editing}
          onSubmit={onSubmitProduct}
          onCancel={() => setForm(null)}
        />
      )}

      {loading && !page ? (
        <p className="mt-8 animate-pulse text-center font-heading text-2xl">Loading inventory...</p>
      ) : !page ? (
        <Card className="mt-6 text-center">
          <p className="text-2xl">The inventory couldn&apos;t be loaded.</p>
          <Button className="mt-4" onClick={() => reload(() => setReloadKey((k) => k + 1))}>
            Try again
          </Button>
        </Card>
      ) : items.length === 0 ? (
        <Card className="mt-6 text-center">
          <PackageSearch aria-hidden strokeWidth={2.5} className="mx-auto h-12 w-12" />
          <p className="mt-4 text-2xl">
            {mode === "low"
              ? "Nothing is running low."
              : search
                ? "No products match that search."
                : mode === "retired"
                  ? "No retired products."
                  : "No products yet."}
          </p>
        </Card>
      ) : (
        <ul className={`mt-6 space-y-4 transition-opacity ${loading ? "opacity-50" : ""}`} aria-busy={loading}>
          {items.map((item) => mode === "retired" ? (
            <li
              key={item.productId}
              className={`flex flex-wrap items-center gap-4 rounded-wobbly-md border-2 border-pencil bg-white p-4 shadow-soft ${busyId === item.productId ? "pointer-events-none opacity-50" : ""}`}
            >
              <div className="min-w-48 flex-1">
                <p className="font-heading text-xl">{item.name}</p>
                <p className="text-base text-pencil/70">
                  {item.sku} · {categoryNames[item.categoryId] ?? "Uncategorized"} · {item.stockQuantity} in stock
                </p>
              </div>
              <button
                type="button"
                className={smallButton}
                disabled={busyId === item.productId}
                aria-label={`Reactivate ${item.name}`}
                onClick={() => void onReactivate(item)}
              >
                <ArchiveRestore aria-hidden strokeWidth={2.5} className="h-4 w-4" />
                Reactivate
              </button>
            </li>
          ) : (
            <InventoryRow
              // Remount when the stock changes so the input shows the saved value.
              key={`${item.productId}:${item.stockQuantity}`}
              item={item}
              categoryName={categoryNames[item.categoryId] ?? "Uncategorized"}
              busy={busyId === item.productId}
              canManage={canManage}
              onSaveQuantity={onSaveQuantity}
              onEdit={(editing) => setForm({ editing })}
              onRetire={onRetire}
              onInvalid={(text) => setNotice({ kind: "error", text })}
            />
          ))}
        </ul>
      )}

      {(offset > 0 || page?.hasMore) && (
        <div className="mt-6 flex justify-between">
          <button
            type="button"
            className={smallButton}
            disabled={offset === 0 || loading}
            onClick={() => reload(() => setOffset((o) => Math.max(0, o - PAGE_SIZE)))}
          >
            Previous
          </button>
          <button
            type="button"
            className={smallButton}
            disabled={!page?.hasMore || loading}
            onClick={() => reload(() => setOffset((o) => o + PAGE_SIZE))}
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
