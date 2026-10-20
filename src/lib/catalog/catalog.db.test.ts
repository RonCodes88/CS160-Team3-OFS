import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildCatalogSearchFilter, selectCategories, selectProduct, selectProducts } from "./db";

// Runs the catalog queries against a LOCAL Supabase with the migrations applied.
// Setup: `npx supabase start`, then put SUPABASE_TEST_URL and
// SUPABASE_TEST_SECRET_KEY in .env.test.local. Skipped when not configured.
try {
  process.loadEnvFile(".env.test.local");
} catch {
  // Optional file.
}

const TEST_URL = process.env.SUPABASE_TEST_URL;
const TEST_KEY = process.env.SUPABASE_TEST_SECRET_KEY;

// host.docker.internal is the developer's own machine when tests run in Docker.
if (
  TEST_URL &&
  !/^http:\/\/(localhost|127\.0\.0\.1|host\.docker\.internal)(:\d+)?\/?$/.test(TEST_URL)
) {
  throw new Error(`Refusing to run DB tests against non-local SUPABASE_TEST_URL: ${TEST_URL}`);
}

const run = randomUUID().slice(0, 8);

describe("buildCatalogSearchFilter", () => {
  it("matches name or description", () => {
    expect(buildCatalogSearchFilter("milk")).toBe('name.ilike."*milk*",description.ilike."*milk*"');
  });

  it("strips filter syntax and wildcards", () => {
    expect(buildCatalogSearchFilter('a,b (c) "d" 50% e*\\')).toBe(
      'name.ilike."*a b c d 50 e*",description.ilike."*a b c d 50 e*"',
    );
  });

  it("returns null when nothing searchable is left", () => {
    expect(buildCatalogSearchFilter(' ,()"%* ')).toBeNull();
  });
});

describe.skipIf(!TEST_URL || !TEST_KEY)("catalog queries against Postgres", () => {
  let db: SupabaseClient;
  const categories: Record<string, string> = {};
  const products: Record<string, string> = {};

  async function insertOne(table: string, row: object): Promise<string> {
    const { data, error } = await db.from(table).insert(row).select("id").single();
    if (error) throw new Error(`${table} insert failed: ${error.message}`);
    return (data as { id: string }).id;
  }

  async function createProduct(
    key: string,
    categoryKey: string,
    name: string,
    { stock = 5, isActive = true, description = "" } = {},
  ) {
    products[key] = await insertOne("products", {
      sku: `${key.toUpperCase()}-${run}`,
      category_id: categories[categoryKey],
      name: `${name} ${run}`,
      description,
      price_cents: 349,
      unit_weight: 125,
      stock_quantity: stock,
      is_active: isActive,
    });
  }

  const names = (list: { name: string }[]) => list.map((p) => p.name.replace(` ${run}`, ""));

  beforeAll(async () => {
    db = createClient(TEST_URL!, TEST_KEY!, { auth: { persistSession: false } });
    categories.fruit = await insertOne("categories", { name: `Fruit ${run}`, slug: `fruit-${run}` });
    categories.retired = await insertOne("categories", {
      name: `Retired ${run}`,
      slug: `retired-${run}`,
      is_active: false,
    });
    await createProduct("kiwi", "fruit", "Kiwi", { description: "Fuzzy green fruit." });
    await createProduct("apple", "fruit", "Apple", { description: "Crisp, 50% off (today)." });
    await createProduct("soldout", "fruit", "Mango", { stock: 0 });
    await createProduct("gone", "fruit", "Plum", { isActive: false });
    await createProduct("hidden", "retired", "Pear");
  });

  afterAll(async () => {
    if (!db) return;
    await db.from("products").delete().in("id", Object.values(products));
    await db.from("categories").delete().in("id", Object.values(categories));
  });

  it("lists only active categories", async () => {
    const slugs = (await selectCategories(db)).map((c) => c.slug);
    expect(slugs).toContain(`fruit-${run}`);
    expect(slugs).not.toContain(`retired-${run}`);
  });

  it("lists only active, in-stock products in active categories, sorted by name", async () => {
    const list = await selectProducts(db, { q: run });
    expect(names(list)).toEqual(["Apple", "Kiwi"]);
    expect(list.every((p) => p.inStock)).toBe(true);
  });

  it("returns integer money and weight and no stock counts", async () => {
    const [apple] = await selectProducts(db, { q: `Apple ${run}` });
    expect(apple).toMatchObject({ priceCents: 349, unitWeight: 125, categoryId: categories.fruit });
    expect(apple).not.toHaveProperty("stockQuantity");
  });

  it("filters by category slug, and a retired or unknown slug matches nothing", async () => {
    expect(names(await selectProducts(db, { category: `fruit-${run}` }))).toEqual(["Apple", "Kiwi"]);
    expect(await selectProducts(db, { category: `retired-${run}` })).toEqual([]);
    expect(await selectProducts(db, { category: `nope-${run}` })).toEqual([]);
  });

  it("searches name and description, ignoring case", async () => {
    const inFruit = { category: `fruit-${run}` };
    expect(names(await selectProducts(db, { ...inFruit, q: "KIWI" }))).toEqual(["Kiwi"]);
    expect(names(await selectProducts(db, { ...inFruit, q: "fuzzy green" }))).toEqual(["Kiwi"]);
  });

  it("treats filter syntax in the search as plain text", async () => {
    const inFruit = { category: `fruit-${run}` };
    expect(names(await selectProducts(db, { ...inFruit, q: "50%" }))).toEqual(["Apple"]);
    expect(names(await selectProducts(db, { ...inFruit, q: "(today)" }))).toEqual(["Apple"]);
    expect(await selectProducts(db, { ...inFruit, q: 'x",name.ilike.*' })).toEqual([]);
  });

  it("gets one public product by id", async () => {
    expect((await selectProduct(db, products.kiwi))?.name).toBe(`Kiwi ${run}`);
  });

  it("returns null for out-of-stock, retired, hidden-category, unknown, and malformed ids", async () => {
    for (const id of [products.soldout, products.gone, products.hidden, randomUUID(), "not-a-uuid"]) {
      expect(await selectProduct(db, id)).toBeNull();
    }
  });
});
