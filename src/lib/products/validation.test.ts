import { describe, expect, it } from "vitest";
import { parseNewProduct, parseProductChanges } from "@/lib/products/validation";

const CATEGORY_ID = "11111111-1111-4111-8111-111111111111";

const validNew = {
  sku: "APL-001",
  categoryId: CATEGORY_ID,
  name: "Gala Apples",
  priceCents: 199,
  unitWeight: 50,
};

describe("parseNewProduct", () => {

  it.each(["sku", "name", "description", "imageUrl"])("rejects NUL in product %s", (field) => {
    const value = field === "imageUrl" ? "https://example.com/a\u0000b.png" : "a\u0000b";
    expect(parseNewProduct({ ...validNew, [field]: value }).ok).toBe(false);
    expect(parseProductChanges({ [field]: value }).ok).toBe(false);
  });
  it("maps camelCase input to columns and fills defaults", () => {
    expect(parseNewProduct(validNew)).toEqual({
      ok: true,
      value: {
        sku: "APL-001",
        category_id: CATEGORY_ID,
        name: "Gala Apples",
        description: "",
        image_url: null,
        price_cents: 199,
        unit_weight: 50,
        stock_quantity: 0,
      },
    });
  });

  it("accepts optional description, image and starting stock", () => {
    const parsed = parseNewProduct({
      ...validNew,
      description: "  Crisp and sweet ",
      imageUrl: "https://example.com/apple.png",
      stockQuantity: 40,
    });
    expect(parsed.ok && parsed.value).toMatchObject({
      description: "Crisp and sweet",
      image_url: "https://example.com/apple.png",
      stock_quantity: 40,
    });
  });

  it("trims text and lowercases the category id", () => {
    const parsed = parseNewProduct({ ...validNew, sku: " APL-001 ", categoryId: CATEGORY_ID.toUpperCase() });
    expect(parsed.ok && parsed.value).toMatchObject({ sku: "APL-001", category_id: CATEGORY_ID });
  });

  it.each(["sku", "categoryId", "name", "priceCents", "unitWeight"])("requires %s", (key) => {
    const body: Record<string, unknown> = { ...validNew };
    delete body[key];
    expect(parseNewProduct(body)).toEqual({ ok: false, message: `${key} is required.` });
  });

  it.each([
    ["blank name", { name: "   " }],
    ["blank sku", { sku: "" }],
    ["sku too long", { sku: "X".repeat(65) }],
    ["name as number", { name: 5 }],
    ["bad category id", { categoryId: "produce" }],
    ["price as float dollars", { priceCents: 1.99 }],
    ["price as string", { priceCents: "199" }],
    ["negative price", { priceCents: -1 }],
    ["zero weight", { unitWeight: 0 }],
    ["fractional weight", { unitWeight: 12.5 }],
    ["negative stock", { stockQuantity: -1 }],
    ["javascript: image url", { imageUrl: "javascript:alert(1)" }],
    ["not a url", { imageUrl: "apple.png" }],
    ["description too long", { description: "x".repeat(2001) }],
  ])("rejects %s", (_label, override) => {
    expect(parseNewProduct({ ...validNew, ...override }).ok).toBe(false);
  });

  it("accepts a free (0 cent) product", () => {
    expect(parseNewProduct({ ...validNew, priceCents: 0 }).ok).toBe(true);
  });

  // Weight is hundredths of a pound; one unit can't exceed the 200 lb cart limit.
  it.each([
    [1999, true],
    [2000, true],
    [19999, true],
    [20000, true],
    [20001, false],
  ])("unitWeight %d -> valid: %s", (unitWeight, valid) => {
    expect(parseNewProduct({ ...validNew, unitWeight }).ok).toBe(valid);
  });

  it("explains where stock and active status are managed instead of ignoring them", () => {
    const withActive = parseNewProduct({ ...validNew, isActive: false });
    expect(withActive.ok).toBe(false);
    expect(!withActive.ok && withActive.message).toContain("DELETE /api/admin/products");
  });

  it("rejects unknown fields", () => {
    expect(parseNewProduct({ ...validNew, id: "x" })).toEqual({ ok: false, message: "Unknown field: id." });
  });

  it.each([null, [], "product", 42])("rejects non-object body %j", (body) => {
    expect(parseNewProduct(body).ok).toBe(false);
  });
});

describe("parseProductChanges", () => {
  it("returns only the fields that were sent", () => {
    expect(parseProductChanges({ priceCents: 249, unitWeight: 60 })).toEqual({
      ok: true,
      value: { price_cents: 249, unit_weight: 60 },
    });
  });

  it("lets null or an empty string clear the image", () => {
    expect(parseProductChanges({ imageUrl: null })).toEqual({ ok: true, value: { image_url: null } });
    expect(parseProductChanges({ imageUrl: "" })).toEqual({ ok: true, value: { image_url: null } });
  });

  it("requires at least one field", () => {
    expect(parseProductChanges({})).toEqual({ ok: false, message: "Send at least one field to change." });
  });

  it("points stock changes to the inventory API", () => {
    const parsed = parseProductChanges({ stockQuantity: 5 });
    expect(parsed.ok).toBe(false);
    expect(!parsed.ok && parsed.message).toContain("/api/staff/inventory");
  });

  it("points retiring to DELETE", () => {
    const parsed = parseProductChanges({ isActive: false });
    expect(!parsed.ok && parsed.message).toContain("DELETE");
  });

  it.each([
    { priceCents: -5 },
    { priceCents: 2.5 },
    { unitWeight: 20001 },
    { name: "" },
    { categoryId: "nope" },
    { description: null },
  ])("rejects invalid change %j", (body) => {
    expect(parseProductChanges(body).ok).toBe(false);
  });
});
