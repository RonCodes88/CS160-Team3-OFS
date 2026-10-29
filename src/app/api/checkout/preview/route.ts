import type { NextRequest } from "next/server";
import { requireRole } from "@/lib/auth/requireRole";
import { readJsonBody } from "@/lib/auth/http";
import { ServiceAreaUnavailable } from "@/lib/auth/serviceArea";
import { createAdminClient } from "@/lib/supabase/admin";
import { internalErrorResponse } from "@/lib/api/errors";
import { isUuid } from "@/lib/inventory/validation";
import { previewCustomerCheckout } from "@/lib/checkout/service";
import { parsePreviewInput, type CheckoutErrorCode } from "@/lib/checkout/validation";
import { DEMO_TAX_POLICY } from "@/lib/checkout/tax";

// Keep HTTP decisions here rather than coupling the reusable validator to Next.js.
// 409 means current catalog/totals conflict with the purchase being reviewed;
// 422 means a well-formed request cannot proceed with this cart or address.
const STATUS: Record<CheckoutErrorCode, number> = {
  INVALID_REQUEST: 400, ADDRESS_REQUIRED: 400, INVALID_TOTALS: 400,
  CART_UNAVAILABLE: 422, CART_EMPTY: 422, INVALID_CART: 422, INVALID_QUANTITY: 422,
  ADDRESS_INVALID: 422, PRODUCT_UNAVAILABLE: 409, INSUFFICIENT_STOCK: 409,
  CART_OVERWEIGHT: 422, TOTALS_MISMATCH: 409,
};

function noStore(response: Response): Response {
  // Totals and errors are customer-specific and may become stale immediately.
  response.headers.set("Cache-Control", "no-store");
  return response;
}

/** Validates a purchase without creating a cart/order, reserving stock, or charging. */
export async function POST(request: NextRequest): Promise<Response> {
  try {
    const db = createAdminClient();
    // Authenticate before reading checkout data. The privileged DB client alone
    // does not enforce the customer's role or resource ownership.
    const auth = await requireRole(request, db, ["CUSTOMER"]);
    if (!auth.ok) return noStore(auth.response);
    const json = await readJsonBody(request);
    if (!json.ok) return noStore(json.response);
    const parsed = parsePreviewInput(json.body);
    if (!parsed.ok) return noStore(Response.json({ error: parsed.error }, { status: 400 }));
    if (!isUuid(parsed.value.addressId)) {
      return noStore(Response.json({ error: { code: "INVALID_REQUEST", message: "addressId must be a UUID." } }, { status: 400 }));
    }
    // UUIDs are case-insensitive in PostgreSQL, but returned IDs are lowercase.
    // Normalize before the validator's exact string comparison of address IDs.
    const result = await previewCustomerCheckout(db, auth.user.id, {
      ...parsed.value, addressId: parsed.value.addressId.toLowerCase(),
    });
    if (!result.ok) {
      // Refreshed totals help the UI request another review; they do not authorize
      // payment or imply that unavailable items were removed from the cart.
      return noStore(Response.json({ error: result.error,
        ...(result.current ? { current: result.current, taxPolicy: DEMO_TAX_POLICY } : {}),
      }, { status: STATUS[result.error.code] }));
    }
    return noStore(Response.json({ ...result.value, taxPolicy: DEMO_TAX_POLICY }));
  } catch (error) {
    if (error instanceof ServiceAreaUnavailable) {
      // Do not blame the customer's address when our delivery settings are absent.
      return noStore(Response.json({ error: { code: "SERVICE_AREA_UNAVAILABLE",
        message: "Delivery availability cannot be checked right now. Please try again later." } }, { status: 503 }));
    }
    return noStore(internalErrorResponse(error));
  }
}
