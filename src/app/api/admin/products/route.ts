import type { NextRequest } from "next/server";
import { errorResponse, internalErrorResponse } from "@/lib/api/errors";
import { MANAGER_ROLES, requireRole } from "@/lib/auth/requireRole";
import { createProduct, productFailureResponse } from "@/lib/products/service";
import { parseNewProduct } from "@/lib/products/validation";
import { createAdminClient } from "@/lib/supabase/admin";

// POST /api/admin/products
// body: { sku, categoryId, name, priceCents, unitWeight, description?, imageUrl?, stockQuantity? }
// Creates a product and writes a PRODUCT_CREATE audit row in one transaction. MANAGER only.
export async function POST(request: NextRequest) {
  try {
    const db = createAdminClient();
    const auth = await requireRole(request, db, MANAGER_ROLES);
    if (!auth.ok) return auth.response;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return errorResponse(400, "VALIDATION_ERROR", "Body must be valid JSON.");
    }
    const product = parseNewProduct(body);
    if (!product.ok) return errorResponse(400, "VALIDATION_ERROR", product.message);

    const result = await createProduct(db, auth.user.id, product.value);
    if (!result.ok) return productFailureResponse(result.reason);
    return Response.json(result.product, { status: 201 });
  } catch (err) {
    return internalErrorResponse(err);
  }
}
