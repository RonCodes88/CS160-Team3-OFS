import type { NextRequest } from "next/server";
import { requireRole } from "@/lib/auth/requireRole";
import { readJsonBody } from "@/lib/auth/http";
import { ServiceAreaUnavailable } from "@/lib/auth/serviceArea";
import { createAdminClient } from "@/lib/supabase/admin";
import { isUuid } from "@/lib/inventory/validation";
import { parsePreviewInput } from "@/lib/checkout/validation";
import { DEMO_TAX_POLICY } from "@/lib/checkout/tax";
import { createCustomerPaymentIntent } from "@/lib/payments/backend";
import { PaymentError } from "@/lib/payments/service";

export const runtime = "nodejs";
const noStore = (response: Response) => {
  response.headers.set("Cache-Control", "no-store");
  return response;
};

/** Creates a resumable test payment; authorization happens later in Stripe.js. */
export async function POST(request: NextRequest): Promise<Response> {
  try {
    const db = createAdminClient();
    const auth = await requireRole(request, db, ["CUSTOMER"]);
    if (!auth.ok) return noStore(auth.response);
    const key = request.headers.get("Idempotency-Key") ?? "";
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(key)) {
      throw new PaymentError(400, "INVALID_IDEMPOTENCY_KEY", "Provide an Idempotency-Key of 1–128 letters, digits, hyphens or underscores.");
    }
    const json = await readJsonBody(request);
    if (!json.ok) return noStore(json.response);
    const parsed = parsePreviewInput(json.body);
    if (!parsed.ok) return noStore(Response.json({ error: parsed.error }, { status: 400 }));
    if (!isUuid(parsed.value.addressId)) throw new PaymentError(400, "INVALID_REQUEST", "addressId must be a UUID.");
    const result = await createCustomerPaymentIntent(db, auth.user.id, key, {
      ...parsed.value, addressId: parsed.value.addressId.toLowerCase(),
    });
    return noStore(Response.json(result));
  } catch (error) {
    if (error instanceof PaymentError) {
      return noStore(Response.json({ error: { code: error.code, message: error.message },
        ...(error.current ? { current: error.current, taxPolicy: DEMO_TAX_POLICY } : {}) }, { status: error.status }));
    }
    if (error instanceof ServiceAreaUnavailable) {
      return noStore(Response.json({ error: { code: "SERVICE_AREA_UNAVAILABLE", message: "Delivery availability cannot be checked right now." } }, { status: 503 }));
    }
    // Provider objects can contain client secrets; never log or serialize them.
    return noStore(Response.json({ error: { code: "INTERNAL_ERROR", message: "Payment could not be prepared. Retry with the same idempotency key." } }, { status: 500 }));
  }
}
