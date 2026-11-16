import { describe, expect, it } from "vitest";
import { buildSearchFilter } from "@/lib/inventory/service";
import {
  DEFAULT_LOW_STOCK_THRESHOLD,
  DEFAULT_PAGE_LIMIT,
  isUuid,
  parseInventoryQuery,
  parseLowStockQuery,
  parseQuantityBody,
} from "@/lib/inventory/validation";

describe("isUuid", () => {

  it("rejects NUL searches before Postgres rejects the query", () => {
    expect(parseInventoryQuery(new URLSearchParams({ q: "milk\u0000" })).ok).toBe(false);
  });
  it("accepts canonical UUIDs in either case", () => {
    expect(isUuid("3f1c2b8e-9a4d-4e2f-8b1a-0c9d7e6f5a41")).toBe(true);
    expect(isUuid("3F1C2B8E-9A4D-4E2F-8B1A-0C9D7E6F5A41")).toBe(true);
  });

  it.each(["", "123", "not-a-uuid", "3f1c2b8e9a4d4e2f8b1a0c9d7e6f5a41", "3f1c2b8e-9a4d-4e2f-8b1a-0c9d7e6f5a4g"])(
    "rejects %j",
    (value) => {
      expect(isUuid(value)).toBe(false);
    },
  );
});

describe("parseQuantityBody", () => {
  it.each([0, 1, 12, 2_147_483_647])("accepts %d", (quantity) => {
    expect(parseQuantityBody({ quantity })).toEqual({ ok: true, value: quantity });
  });

  it.each([
    ["negative", { quantity: -1 }],
    ["fractional", { quantity: 1.5 }],
    ["numeric string", { quantity: "5" }],
    ["null", { quantity: null }],
    ["missing", {}],
    ["NaN", { quantity: Number.NaN }],
    ["Infinity", { quantity: Number.POSITIVE_INFINITY }],
    ["too large for INTEGER", { quantity: 2_147_483_648 }],
  ])("rejects a %s quantity", (_label, body) => {
    expect(parseQuantityBody(body).ok).toBe(false);
  });

  it.each([null, [], "12", 12])("rejects a non-object body %j", (body) => {
    expect(parseQuantityBody(body).ok).toBe(false);
  });

  it("explains negative quantities", () => {
    expect(parseQuantityBody({ quantity: -3 })).toEqual({
      ok: false,
      message: "quantity cannot be negative.",
    });
  });
});

describe("parseInventoryQuery", () => {
  it("defaults to no search and the first page", () => {
    expect(parseInventoryQuery(new URLSearchParams())).toEqual({
      ok: true,
      value: { search: "", limit: DEFAULT_PAGE_LIMIT, offset: 0 },
    });
  });

  it("trims the search term and reads paging", () => {
    expect(parseInventoryQuery(new URLSearchParams("q=  milk &limit=10&offset=20"))).toEqual({
      ok: true,
      value: { search: "milk", limit: 10, offset: 20 },
    });
  });

  it.each(["limit=0", "limit=101", "limit=-1", "limit=abc", "limit=1.5", "offset=-1", "offset=x"])(
    "rejects %s",
    (qs) => {
      expect(parseInventoryQuery(new URLSearchParams(qs)).ok).toBe(false);
    },
  );

  it("rejects a search term over 100 characters", () => {
    const params = new URLSearchParams({ q: "a".repeat(101) });
    expect(parseInventoryQuery(params).ok).toBe(false);
  });
});

describe("parseLowStockQuery", () => {
  it("defaults the threshold", () => {
    const parsed = parseLowStockQuery(new URLSearchParams());
    expect(parsed).toEqual({
      ok: true,
      value: { threshold: DEFAULT_LOW_STOCK_THRESHOLD, limit: DEFAULT_PAGE_LIMIT, offset: 0 },
    });
  });

  it("accepts a threshold of 0", () => {
    const parsed = parseLowStockQuery(new URLSearchParams("threshold=0"));
    expect(parsed.ok && parsed.value.threshold).toBe(0);
  });

  it.each(["threshold=-1", "threshold=2.5", "threshold=ten"])("rejects %s", (qs) => {
    expect(parseLowStockQuery(new URLSearchParams(qs)).ok).toBe(false);
  });
});

describe("buildSearchFilter", () => {
  it("returns null for an empty term", () => {
    expect(buildSearchFilter("")).toBeNull();
    expect(buildSearchFilter("  ")).toBeNull();
  });

  it("matches name or SKU", () => {
    expect(buildSearchFilter("milk")).toBe('name.ilike."*milk*",sku.ilike."*milk*"');
  });

  it("strips filter syntax and wildcards so input cannot add conditions", () => {
    const filter = buildSearchFilter('a",is_active.eq.false,(b)%*\\');
    expect(filter).toBe('name.ilike."*a is_active.eq.false b*",sku.ilike."*a is_active.eq.false b*"');
  });

  it("returns null when only special characters are given", () => {
    expect(buildSearchFilter('%*,()"')).toBeNull();
  });
});
