import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { retire, saveStock, submitProduct, withItem, withoutItem } from "./inventoryActions";
import { EMPTY_PRODUCT_FORM, formFromItem } from "./productInput";
import type { InventoryItem, Product } from "./staffApi";

const ITEM: InventoryItem = {
  productId: "p1",
  sku: "MILK-1",
  name: "Whole Milk",
  categoryId: "c1",
  description: "",
  imageUrl: null,
  priceCents: 499,
  unitWeight: 860,
  stockQuantity: 40,
  updatedAt: "2026-10-28T12:00:00Z",
};

const PRODUCT: Product = {
  id: "p1",
  sku: "MILK-1",
  categoryId: "c1",
  name: "Whole Milk",
  description: "",
  imageUrl: null,
  priceCents: 525,
  unitWeight: 860,
  stockQuantity: 40,
  isActive: true,
  updatedAt: "2026-10-28T13:00:00Z",
};

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const apiError = (status: number, message: string) =>
  fetchMock.mockResolvedValueOnce(Response.json({ error: { code: "X", message } }, { status }));

describe("saveStock", () => {
  it("returns the updated row and says what changed", async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({ productId: "p1", oldQuantity: 40, newQuantity: 38, changed: true }),
    );
    expect(await saveStock(ITEM, 38)).toEqual({
      item: { ...ITEM, stockQuantity: 38 },
      notice: { kind: "success", text: "Whole Milk stock changed from 40 to 38." },
    });
  });

  it("says so when the count was already right", async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({ productId: "p1", oldQuantity: 40, newQuantity: 40, changed: false }),
    );
    expect((await saveStock(ITEM, 40)).notice).toEqual({ kind: "success", text: "Whole Milk already had 40 in stock." });
  });

  it("shows the API's error and leaves the row alone", async () => {
    apiError(403, "You do not have access to this resource.");
    expect(await saveStock(ITEM, 5)).toEqual({
      item: null,
      notice: { kind: "error", text: "Whole Milk: You do not have access to this resource." },
    });
  });
});

describe("retire", () => {
  it("reports a retired product", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ product: { ...PRODUCT, isActive: false }, changed: true }));
    expect(await retire(ITEM)).toEqual({ retired: true, notice: { kind: "success", text: "Whole Milk was retired." } });
  });

  it("keeps the product when retiring fails", async () => {
    apiError(404, "Product not found.");
    expect(await retire(ITEM)).toEqual({
      retired: false,
      notice: { kind: "error", text: "Whole Milk: Product not found." },
    });
  });
});

describe("submitProduct", () => {
  const newProduct = {
    ...EMPTY_PRODUCT_FORM,
    sku: "EGG-12",
    name: "Eggs",
    categoryId: "c1",
    price: "3.99",
    weight: "1.50",
    stock: "24",
  };

  it("creates a product from the form", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ ...PRODUCT, id: "p2", name: "Eggs" }, { status: 201 }));
    const result = await submitProduct(newProduct, null);
    expect(result).toMatchObject({ ok: true, created: true, item: { productId: "p2", name: "Eggs" } });
    expect(result.ok && result.notice).toEqual({ kind: "success", text: "Created Eggs." });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ priceCents: 399, unitWeight: 150, stockQuantity: 24 });
  });

  it("shows a duplicate SKU from the API", async () => {
    apiError(409, "Another product already uses this SKU.");
    expect(await submitProduct(newProduct, null)).toEqual({ ok: false, message: "Another product already uses this SKU." });
  });

  it("stops an invalid form before calling the API", async () => {
    expect(await submitProduct({ ...newProduct, weight: "250" }, null)).toEqual({
      ok: false,
      message: "Enter a weight between 0.01 and 200.00 lb.",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("saves only the edited fields and returns the server's product", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ product: PRODUCT, changed: true }));
    const result = await submitProduct({ ...formFromItem(ITEM), price: "5.25" }, ITEM);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/admin/products/p1");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ priceCents: 525 });
    expect(result).toMatchObject({ ok: true, created: false, item: { priceCents: 525, updatedAt: PRODUCT.updatedAt } });
  });

  it("does not send an edit that changes nothing", async () => {
    expect(await submitProduct(formFromItem(ITEM), ITEM)).toEqual({ ok: false, message: "Nothing changed." });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows an API error on edit", async () => {
    apiError(400, "imageUrl must start with http:// or https://.");
    expect(await submitProduct({ ...formFromItem(ITEM), name: "Milk" }, ITEM)).toEqual({
      ok: false,
      message: "imageUrl must start with http:// or https://.",
    });
  });
});

describe("list updates", () => {
  const other = { ...ITEM, productId: "p2", name: "Eggs" };
  const page = { items: [ITEM, other], hasMore: true };

  it("replaces only the matching row and keeps its position", () => {
    const updated = { ...ITEM, stockQuantity: 3 };
    expect(withItem(page, updated)).toEqual({ items: [updated, other], hasMore: true });
  });

  it("leaves the list alone when the product isn't on this page", () => {
    expect(withItem(page, { ...ITEM, productId: "p9" })).toEqual(page);
  });

  it("removes a retired product", () => {
    expect(withoutItem(page, "p1")).toEqual({ items: [other], hasMore: true });
  });

  it("does nothing before the first page has loaded", () => {
    expect(withItem(null, ITEM)).toBeNull();
    expect(withoutItem(null, "p1")).toBeNull();
  });
});
