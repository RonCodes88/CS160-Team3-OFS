import { describe, expect, it } from "vitest";
import { MAX_SEARCH_LENGTH, parseShopQuery, shopHref } from "./query";

describe("parseShopQuery", () => {

  it("normalizes control characters before database searches", () => {
    expect(parseShopQuery({ q: "milk\u0000eggs\u007f" })).toEqual({ q: "milk eggs" });
  });
  it("returns no filters for empty params", () => {
    expect(parseShopQuery({})).toEqual({});
  });

  it("trims and collapses whitespace in the search", () => {
    expect(parseShopQuery({ q: "  whole   milk " })).toEqual({ q: "whole milk" });
  });

  it("drops a blank search", () => {
    expect(parseShopQuery({ q: "   " })).toEqual({});
  });

  it("caps the search length", () => {
    expect(parseShopQuery({ q: "a".repeat(500) }).q).toHaveLength(MAX_SEARCH_LENGTH);
  });

  it("uses the first value when a param repeats", () => {
    expect(parseShopQuery({ q: ["rice", "milk"], category: ["pantry", "dairy-eggs"] })).toEqual({
      q: "rice",
      category: "pantry",
    });
  });

  it("lowercases the category slug", () => {
    expect(parseShopQuery({ category: "Dairy-Eggs" })).toEqual({ category: "dairy-eggs" });
  });

  it.each(["", "../etc", "dairy eggs", "-produce", "produce-", "pro--duce", "a%20b"])(
    "drops malformed category %j",
    (category) => {
      expect(parseShopQuery({ category })).toEqual({});
    },
  );
});

describe("shopHref", () => {
  it("links to the plain shop with no filters", () => {
    expect(shopHref({})).toBe("/shop");
  });

  it("includes search and category", () => {
    expect(shopHref({ q: "cold brew", category: "beverages" })).toBe("/shop?q=cold+brew&category=beverages");
  });

  it("encodes special characters", () => {
    expect(shopHref({ q: "mac & cheese" })).toBe("/shop?q=mac+%26+cheese");
  });

  it("round-trips through parseShopQuery", () => {
    const query = { q: "mac & cheese?", category: "pantry" };
    const params = Object.fromEntries(new URL(shopHref(query), "http://x").searchParams);
    expect(parseShopQuery(params)).toEqual(query);
  });
});
