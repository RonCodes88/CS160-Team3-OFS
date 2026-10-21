import { describe, expect, it } from "vitest";
import { parseAuditLogQuery } from "@/lib/audit/log";

const PRODUCT_ID = "3f1c2b8e-9a4d-4e2f-8b1a-0c9d7e6f5a41";

describe("parseAuditLogQuery", () => {
  it("defaults to no filters and the first page", () => {
    expect(parseAuditLogQuery(new URLSearchParams())).toEqual({
      ok: true,
      value: { productId: null, action: null, limit: 50, offset: 0 },
    });
  });

  it("reads product, action and paging filters", () => {
    const params = new URLSearchParams({
      productId: PRODUCT_ID.toUpperCase(),
      action: "PRODUCT_UPDATE",
      limit: "10",
      offset: "20",
    });
    expect(parseAuditLogQuery(params)).toEqual({
      ok: true,
      value: { productId: PRODUCT_ID, action: "PRODUCT_UPDATE", limit: 10, offset: 20 },
    });
  });

  it.each(["productId=abc", "action=DROP_TABLE", "action=product_update", "limit=0", "offset=-1"])(
    "rejects %s",
    (qs) => {
      expect(parseAuditLogQuery(new URLSearchParams(qs)).ok).toBe(false);
    },
  );
});
