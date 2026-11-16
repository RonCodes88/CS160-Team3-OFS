// What each inventory action sends and what the dashboard shows afterward.
// Kept apart from the panel so the outcomes can be tested without a browser.

import type { NoticeValue } from "./Notice";
import { toChangesBody, toCreateBody, type ProductFormValues } from "./productInput";
import {
  createProduct,
  reactivateProduct,
  retireProduct,
  saveQuantity,
  updateProduct,
  type InventoryItem,
  type InventoryPage,
  type Product,
} from "./staffApi";

export function toItem(product: Product): InventoryItem {
  return {
    productId: product.id,
    sku: product.sku,
    name: product.name,
    categoryId: product.categoryId,
    description: product.description,
    imageUrl: product.imageUrl,
    priceCents: product.priceCents,
    unitWeight: product.unitWeight,
    stockQuantity: product.stockQuantity,
    updatedAt: product.updatedAt,
  };
}

/** The page with `item` swapped in for the row with the same product ID. */
export function withItem(page: InventoryPage | null, item: InventoryItem): InventoryPage | null {
  return page && { ...page, items: page.items.map((i) => (i.productId === item.productId ? item : i)) };
}

/** The page without the given product, e.g. after it is retired. */
export function withoutItem(page: InventoryPage | null, productId: string): InventoryPage | null {
  return page && { ...page, items: page.items.filter((i) => i.productId !== productId) };
}

const failed = (item: InventoryItem, message: string): NoticeValue => ({
  kind: "error",
  text: `${item.name}: ${message}`,
});

/** Sets the stock count. `item` is the updated row, or null if the save failed. */
export async function saveStock(
  item: InventoryItem,
  quantity: number,
): Promise<{ item: InventoryItem | null; notice: NoticeValue }> {
  const result = await saveQuantity(item.productId, quantity, item.stockQuantity);
  if (!result.ok) return { item: null, notice: failed(item, result.message) };
  const { changed, oldQuantity, newQuantity } = result.data;
  return {
    item: { ...item, stockQuantity: newQuantity },
    notice: {
      kind: "success",
      text: changed
        ? `${item.name} stock changed from ${oldQuantity} to ${newQuantity}.`
        : `${item.name} already had ${newQuantity} in stock.`,
    },
  };
}

/** Retires the product so customers no longer see it. */
export async function retire(item: InventoryItem): Promise<{ retired: boolean; notice: NoticeValue }> {
  const result = await retireProduct(item.productId);
  if (!result.ok) return { retired: false, notice: failed(item, result.message) };
  return { retired: true, notice: { kind: "success", text: `${item.name} was retired.` } };
}

/** Puts a retired product back in the shop. */
export async function reactivate(item: InventoryItem): Promise<{ reactivated: boolean; notice: NoticeValue }> {
  const result = await reactivateProduct(item.productId);
  if (!result.ok) return { reactivated: false, notice: failed(item, result.message) };
  return { reactivated: true, notice: { kind: "success", text: `${item.name} is back in the shop.` } };
}

export type ProductSubmitResult =
  | { ok: false; message: string }
  | { ok: true; created: boolean; item: InventoryItem; notice: NoticeValue };

/** Creates a product, or saves the changed fields of `editing`. */
export async function submitProduct(
  values: ProductFormValues,
  editing: InventoryItem | null,
): Promise<ProductSubmitResult> {
  if (editing) {
    const body = toChangesBody(values, editing);
    if (!body.ok) return body;
    const result = await updateProduct(editing.productId, body.value);
    if (!result.ok) return { ok: false, message: result.message };
    const { product } = result.data;
    return {
      ok: true,
      created: false,
      item: toItem(product),
      notice: { kind: "success", text: `Saved changes to ${product.name}.` },
    };
  }
  const body = toCreateBody(values);
  if (!body.ok) return body;
  const result = await createProduct(body.value);
  if (!result.ok) return { ok: false, message: result.message };
  return {
    ok: true,
    created: true,
    item: toItem(result.data),
    notice: { kind: "success", text: `Created ${result.data.name}.` },
  };
}
