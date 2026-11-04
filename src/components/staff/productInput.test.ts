import { describe, expect, it } from "vitest";
import {
  EMPTY_PRODUCT_FORM,
  formatHundredths,
  formFromItem,
  parseHundredths,
  parseQuantityInput,
  parseThreshold,
  toChangesBody,
  toCreateBody,
  type ProductFormValues,
} from "./productInput";
import type { InventoryItem } from "./staffApi";

const CATEGORY = "7a1c2b8e-9a4d-4e2f-8b1a-0c9d7e6f5a41";

const ITEM: InventoryItem = {
  productId: "3f1c2b8e-9a4d-4e2f-8b1a-0c9d7e6f5a41",
  sku: "MILK-1",
  name: "Whole Milk",
  categoryId: CATEGORY,
  description: "One gallon",
  imageUrl: null,
  priceCents: 499,
  unitWeight: 860,
  stockQuantity: 12,
  updatedAt: "2026-10-28T12:00:00Z",
};

const form = (overrides: Partial<ProductFormValues> = {}): ProductFormValues => ({
  ...EMPTY_PRODUCT_FORM,
  sku: "EGG-12",
  name: "Eggs",
  categoryId: CATEGORY,
  price: "3.99",
  weight: "1.50",
  stock: "24",
  ...overrides,
});

describe("parseHundredths", () => {
  it.each([
    ["0", 0],
    ["5", 500],
    ["3.9", 390],
    ["3.99", 399],
    ["$12.05", 1205],
    [" 19.99 ", 1999],
    ["20.00", 2000],
    ["199.99", 19999],
    ["200.00", 20000],
    ["200.01", 20001],
  ])("reads %j as %i without floating point", (text, expected) => {
    expect(parseHundredths(text)).toBe(expected);
  });

  it.each(["", "abc", "1.999", "-1", "1,000", ".5", "1e3", "99999999999999999999"])("rejects %j", (text) => {
    expect(parseHundredths(text)).toBeNull();
  });
});

describe("formatHundredths", () => {
  it.each([
    [0, "0.00"],
    [5, "0.05"],
    [399, "3.99"],
    [20000, "200.00"],
  ])("formats %i as %j", (value, expected) => {
    expect(formatHundredths(value)).toBe(expected);
  });
});

describe("toCreateBody", () => {
  it("converts the form into the API's integer fields", () => {
    expect(toCreateBody(form({ imageUrl: " ", description: "  Large  " }))).toEqual({
      ok: true,
      value: {
        sku: "EGG-12",
        name: "Eggs",
        categoryId: CATEGORY,
        description: "Large",
        imageUrl: null,
        priceCents: 399,
        unitWeight: 150,
        stockQuantity: 24,
      },
    });
  });

  it.each<[Partial<ProductFormValues>, string]>([
    [{ sku: " " }, "Enter a SKU."],
    [{ sku: "x".repeat(65) }, "SKU must be at most 64 characters."],
    [{ name: "" }, "Enter a product name."],
    [{ name: "x".repeat(201) }, "Name must be at most 200 characters."],
    [{ categoryId: "" }, "Choose a category."],
    [{ price: "free" }, "Enter a price like 3.99."],
    [{ price: "99999999.99" }, "Enter a price like 3.99."],
    [{ weight: "0" }, "Enter a weight between 0.01 and 200.00 lb."],
    [{ weight: "200.01" }, "Enter a weight between 0.01 and 200.00 lb."],
    [{ stock: "-1" }, "Starting stock must be a whole number, 0 or more."],
    [{ stock: "2.5" }, "Starting stock must be a whole number, 0 or more."],
    [{ stock: "9999999999" }, "Starting stock must be a whole number, 0 or more."],
  ])("rejects %o", (overrides, message) => {
    expect(toCreateBody(form(overrides))).toEqual({ ok: false, message });
  });

  it("accepts the 200.00 lb maximum unit weight", () => {
    const body = toCreateBody(form({ weight: "200.00" }));
    expect(body.ok && body.value.unitWeight).toBe(20000);
  });
});

describe("toChangesBody", () => {
  it("round-trips an unchanged product as nothing to save", () => {
    expect(toChangesBody(formFromItem(ITEM), ITEM)).toEqual({ ok: false, message: "Nothing changed." });
  });

  it("sends only the fields that changed", () => {
    const values = { ...formFromItem(ITEM), price: "5.25", imageUrl: "https://example.com/milk.png" };
    expect(toChangesBody(values, ITEM)).toEqual({
      ok: true,
      value: { priceCents: 525, imageUrl: "https://example.com/milk.png" },
    });
  });

  it("clears the image when the URL is emptied", () => {
    const item = { ...ITEM, imageUrl: "https://example.com/milk.png" };
    expect(toChangesBody({ ...formFromItem(item), imageUrl: "" }, item)).toEqual({
      ok: true,
      value: { imageUrl: null },
    });
  });

  it("validates before comparing", () => {
    expect(toChangesBody({ ...formFromItem(ITEM), weight: "" }, ITEM).ok).toBe(false);
  });
});

describe("formFromItem", () => {
  it("shows money and weight as decimal text", () => {
    expect(formFromItem(ITEM)).toMatchObject({ price: "4.99", weight: "8.60", stock: "12", imageUrl: "" });
  });
});

describe("parseQuantityInput", () => {
  it("accepts whole numbers including 0", () => {
    expect(parseQuantityInput(" 0 ")).toEqual({ ok: true, value: 0 });
    expect(parseQuantityInput("40")).toEqual({ ok: true, value: 40 });
  });

  it.each(["", "-3", "1.5", "ten"])("rejects %j", (text) => {
    expect(parseQuantityInput(text)).toEqual({ ok: false, message: "Stock must be a whole number, 0 or more." });
  });

  it("rejects values the database can't store", () => {
    expect(parseQuantityInput("2147483648")).toEqual({ ok: false, message: "That quantity is too large." });
  });
});

describe("parseThreshold", () => {
  it("uses the number the employee typed, including 0", () => {
    expect(parseThreshold(" 5 ")).toBe(5);
    expect(parseThreshold("0")).toBe(0);
  });

  it.each(["", "abc", "-1", "2.5", "2147483648"])("falls back to the default for %j", (text) => {
    expect(parseThreshold(text)).toBe(10);
  });
});
