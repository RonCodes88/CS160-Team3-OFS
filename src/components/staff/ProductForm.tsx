"use client";

import { useId, useState, type FormEvent, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import type { CatalogCategory } from "@/lib/catalog/types";
import { MAX_DESCRIPTION_LENGTH, MAX_NAME_LENGTH, MAX_SKU_LENGTH } from "@/lib/products/validation";
import { EMPTY_PRODUCT_FORM, formFromItem, type ProductFormValues } from "./productInput";
import type { InventoryItem } from "./staffApi";
import { inputClass } from "./styles";

type Props = {
  categories: readonly CatalogCategory[];
  /** The product being edited, or null to create one. */
  editing: InventoryItem | null;
  /** Saves the form; resolves to an error message to show, or null on success. */
  onSubmit: (values: ProductFormValues) => Promise<string | null>;
  onCancel: () => void;
};

/** Manager form for creating or editing a product. Stock is changed from the inventory list. */
export function ProductForm({ categories, editing, onSubmit, onCancel }: Props) {
  const [values, setValues] = useState<ProductFormValues>(editing ? formFromItem(editing) : EMPTY_PRODUCT_FORM);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const knownCategory = categories.some((c) => c.id === values.categoryId);
  const formId = useId();
  const idFor = (key: keyof ProductFormValues) => `${formId}-${key}`;

  function set<K extends keyof ProductFormValues>(key: K) {
    return (event: { target: { value: string } }) => setValues((v) => ({ ...v, [key]: event.target.value }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const message = await onSubmit(values);
    // On success the parent closes the form, so only a failure updates it.
    if (message) {
      setError(message);
      setBusy(false);
    }
  }

  return (
    <Card tone="postit" className="mt-6">
      <h2 className="text-3xl">{editing ? `Edit ${editing.name}` : "New product"}</h2>
      <form onSubmit={submit} className="mt-4 grid gap-4 sm:grid-cols-2" noValidate>
        <div
          role="alert"
          className={
            error
              ? "flex items-start gap-3 rounded-wobbly-md border-[3px] border-marker bg-white p-3 text-lg sm:col-span-2"
              : "sr-only"
          }
        >
          {error && (
            <>
              <AlertTriangle aria-hidden strokeWidth={2.5} className="mt-1 h-5 w-5 shrink-0 text-marker" />
              <p>{error}</p>
            </>
          )}
        </div>

        <Field label="Name" htmlFor={idFor("name")}>
          <input
            id={idFor("name")}
            value={values.name}
            onChange={set("name")}
            maxLength={MAX_NAME_LENGTH}
            required
            disabled={busy}
            className={`${inputClass} w-full`}
          />
        </Field>
        <Field label="SKU" htmlFor={idFor("sku")}>
          <input
            id={idFor("sku")}
            value={values.sku}
            onChange={set("sku")}
            maxLength={MAX_SKU_LENGTH}
            required
            disabled={busy}
            className={`${inputClass} w-full`}
          />
        </Field>
        <Field label="Category" htmlFor={idFor("categoryId")}>
          <select
            id={idFor("categoryId")}
            value={values.categoryId}
            onChange={set("categoryId")}
            required
            disabled={busy}
            className={`${inputClass} w-full`}
          >
            <option value="">Choose a category</option>
            {!knownCategory && values.categoryId && <option value={values.categoryId}>(Inactive category)</option>}
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Price ($)" htmlFor={idFor("price")}>
          <input
            id={idFor("price")}
            value={values.price}
            onChange={set("price")}
            inputMode="decimal"
            placeholder="3.99"
            required
            disabled={busy}
            className={`${inputClass} w-full`}
          />
        </Field>
        <Field label="Weight per unit (lb)" htmlFor={idFor("weight")}>
          <input
            id={idFor("weight")}
            value={values.weight}
            onChange={set("weight")}
            inputMode="decimal"
            placeholder="1.25"
            required
            disabled={busy}
            className={`${inputClass} w-full`}
          />
        </Field>
        {editing ? (
          <p className="self-end text-base text-pencil/70">
            Stock is {editing.stockQuantity}. Change it from the inventory list.
          </p>
        ) : (
          <Field label="Starting stock" htmlFor={idFor("stock")}>
            <input
              id={idFor("stock")}
              value={values.stock}
              onChange={set("stock")}
              inputMode="numeric"
              disabled={busy}
              className={`${inputClass} w-full`}
            />
          </Field>
        )}
        <Field label="Image URL (optional)" htmlFor={idFor("imageUrl")} wide>
          <input
            id={idFor("imageUrl")}
            value={values.imageUrl}
            onChange={set("imageUrl")}
            type="url"
            placeholder="https://..."
            disabled={busy}
            className={`${inputClass} w-full`}
          />
        </Field>
        <Field label="Description (optional)" htmlFor={idFor("description")} wide>
          <textarea
            id={idFor("description")}
            value={values.description}
            onChange={set("description")}
            maxLength={MAX_DESCRIPTION_LENGTH}
            rows={3}
            disabled={busy}
            className={`${inputClass} h-auto w-full py-2`}
          />
        </Field>

        <div className="flex flex-wrap gap-3 sm:col-span-2">
          <Button type="submit" disabled={busy}>
            {busy ? "Saving..." : editing ? "Save changes" : "Create product"}
          </Button>
          <Button variant="secondary" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}

function Field({
  label,
  htmlFor,
  wide = false,
  children,
}: {
  label: string;
  htmlFor: string;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={wide ? "sm:col-span-2" : ""}>
      <label htmlFor={htmlFor} className="text-lg">
        {label}
      </label>
      <div className="mt-1">{children}</div>
    </div>
  );
}
