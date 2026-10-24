import type { NextRequest } from "next/server";
import { errorResponse, internalErrorResponse } from "@/lib/api/errors";
import { readJsonBody } from "@/lib/auth/http";
import { requireRole } from "@/lib/auth/requireRole";
import { CartError, type CartErrorCode, getCustomerCart, setCustomerCartItem } from "@/lib/cart/service";
import { isUuid } from "@/lib/inventory/validation";
import { createAdminClient } from "@/lib/supabase/admin";

// Same meanings as checkout preview: 409 means the catalog conflicts with the
// requested change; 422 means a well-formed change breaks a cart rule.
const STATUS: Record<CartErrorCode, number> = {
  PRODUCT_UNAVAILABLE: 409,
  INSUFFICIENT_STOCK: 409,
  CART_OVERWEIGHT: 422,
};

// The RPC takes a Postgres integer; larger values would fail as a server error.
const MAX_QUANTITY = 2_147_483_647;

// GET /api/cart
// Returns the session customer's active cart (created if missing) with
// server-priced totals. CUSTOMER only.
export async function GET(request: NextRequest) {
  try {
    const db = createAdminClient();
    const auth = await requireRole(request, db, ["CUSTOMER"]);
    if (!auth.ok) return auth.response;

    return Response.json(await getCustomerCart(db, auth.user.id));
  } catch (err) {
    return internalErrorResponse(err);
  }
}

// POST /api/cart  { productId, quantity }
// Sets one line's quantity (0 removes it) and returns the updated cart.
// Stock and the 200 lb limit are enforced by the database. CUSTOMER only.
export async function POST(request: NextRequest) {
  try {
    const db = createAdminClient();
    const auth = await requireRole(request, db, ["CUSTOMER"]);
    if (!auth.ok) return auth.response;

    const json = await readJsonBody(request);
    if (!json.ok) return json.response;
    if (!json.body || typeof json.body !== "object") {
      return errorResponse(400, "VALIDATION_ERROR", "Request body is required.");
    }

    const { productId, quantity } = json.body as { productId?: unknown; quantity?: unknown };
    if (
      typeof productId !== "string" ||
      !isUuid(productId) ||
      typeof quantity !== "number" ||
      !Number.isSafeInteger(quantity) ||
      quantity < 0 ||
      quantity > MAX_QUANTITY
    ) {
      return errorResponse(400, "VALIDATION_ERROR", "Invalid product ID or quantity.");
    }

    return Response.json(await setCustomerCartItem(db, auth.user.id, productId, quantity));
  } catch (err) {
    if (err instanceof CartError) {
      return Response.json({ error: { code: err.code, message: err.message } }, { status: STATUS[err.code] });
    }
    return internalErrorResponse(err);
  }
}
