"use client";

import { useState, type FormEvent } from "react";
import { Archive, Pencil, Save } from "lucide-react";
import { formatCents, formatWeight } from "@/lib/cart/format";
import { DEFAULT_LOW_STOCK_THRESHOLD } from "@/lib/inventory/validation";
import { parseQuantityInput } from "./productInput";
import type { InventoryItem } from "./staffApi";
import { inputClass, smallButton } from "./styles";

type Props = {
  item: InventoryItem;
  categoryName: string;
  busy: boolean;
  /** Managers can edit and retire products; employees only change stock. */
  canManage: boolean;
  onSaveQuantity: (item: InventoryItem, quantity: number) => void;
  onEdit: (item: InventoryItem) => void;
  onRetire: (item: InventoryItem) => void;
  /** Reports a quantity that can't be sent, without calling the API. */
  onInvalid: (message: string) => void;
};

/** One product with an editable stock count. */
export function InventoryRow({
  item,
  categoryName,
  busy,
  canManage,
  onSaveQuantity,
  onEdit,
  onRetire,
  onInvalid,
}: Props) {
  const [quantity, setQuantity] = useState(String(item.stockQuantity));
  const [confirmRetire, setConfirmRetire] = useState(false);
  const low = item.stockQuantity <= DEFAULT_LOW_STOCK_THRESHOLD;
  const inputId = `qty-${item.productId}`;

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = parseQuantityInput(quantity);
    if (!parsed.ok) return onInvalid(`${item.name}: ${parsed.message}`);
    onSaveQuantity(item, parsed.value);
  }

  return (
    <li
      className={`rounded-wobbly-md border-2 border-pencil bg-white p-4 shadow-soft transition-opacity ${busy ? "pointer-events-none opacity-50" : ""}`}
    >
      <div className="flex flex-wrap items-center gap-4">
        <div className="min-w-48 flex-1">
          <p className="font-heading text-xl">
            {item.name}
            {low && (
              <span className="ml-2 inline-block -rotate-2 border-2 border-marker bg-white px-2 text-sm text-marker">
                {item.stockQuantity === 0 ? "Out of stock" : "Low stock"}
              </span>
            )}
          </p>
          <p className="text-base text-pencil/70">
            {item.sku} · {categoryName} · {formatCents(item.priceCents)} · {formatWeight(item.unitWeight)}
          </p>
        </div>

        <form onSubmit={onSubmit} className="flex items-center gap-2">
          <label htmlFor={inputId} className="text-base">
            Stock
          </label>
          <input
            id={inputId}
            inputMode="numeric"
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
            disabled={busy}
            className={`${inputClass} w-24 text-right tabular-nums`}
          />
          <button
            type="submit"
            className={smallButton}
            disabled={busy || quantity.trim() === String(item.stockQuantity)}
            aria-label={`Save stock for ${item.name}`}
          >
            <Save aria-hidden strokeWidth={2.5} className="h-4 w-4" />
            Save
          </button>
        </form>

        {canManage && (
          <div className="flex gap-2">
            <button type="button" className={smallButton} onClick={() => onEdit(item)} disabled={busy}>
              <Pencil aria-hidden strokeWidth={2.5} className="h-4 w-4" />
              Edit
            </button>
            <button type="button" className={smallButton} onClick={() => setConfirmRetire(true)} disabled={busy}>
              <Archive aria-hidden strokeWidth={2.5} className="h-4 w-4" />
              Retire
            </button>
          </div>
        )}
      </div>

      {canManage && confirmRetire && (
        <div className="mt-3 flex flex-wrap items-center gap-3 border-t-2 border-dashed border-pencil pt-3">
          <p className="flex-1 text-lg">
            Retire {item.name}? Customers will no longer see it. Past orders keep their record.
          </p>
          <button
            type="button"
            className={`${smallButton} hover:bg-marker hover:text-white`}
            onClick={() => {
              setConfirmRetire(false);
              onRetire(item);
            }}
          >
            Yes, retire
          </button>
          <button type="button" className={smallButton} onClick={() => setConfirmRetire(false)}>
            Keep it
          </button>
        </div>
      )}
    </li>
  );
}
