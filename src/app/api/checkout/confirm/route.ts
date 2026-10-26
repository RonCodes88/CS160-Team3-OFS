import type { NextRequest } from "next/server";
import { requireRole } from "@/lib/auth/requireRole";
import { readJsonBody } from "@/lib/auth/http";
import { createAdminClient } from "@/lib/supabase/admin";
import { isUuid } from "@/lib/inventory/validation";
import { confirmCustomerPayment } from "@/lib/payments/finalize-backend";
import { PaymentError } from "@/lib/payments/service";

export const runtime = "nodejs";
const noStore = (response: Response) => { response.headers.set("Cache-Control", "no-store"); return response; };

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const db = createAdminClient();
    const auth = await requireRole(request, db, ["CUSTOMER"]);
    if (!auth.ok) return noStore(auth.response);
    const key = request.headers.get("Idempotency-Key") ?? "";
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(key)) throw new PaymentError(400, "INVALID_IDEMPOTENCY_KEY", "Provide the original payment Idempotency-Key.");
    const json = await readJsonBody(request);
    if (!json.ok) return noStore(json.response);
    const id = (json.body as { attemptId?: unknown } | null)?.attemptId;
    if (typeof id !== "string" || !isUuid(id)) throw new PaymentError(400, "INVALID_REQUEST", "attemptId must be a UUID.");
    const result = await confirmCustomerPayment(db, auth.user.id, id.toLowerCase(), key);
    if (result.failureCode) return noStore(Response.json({ ...result,
      error: { code: result.failureCode, message: "Payment did not complete this purchase. Review checkout before trying again." } }, { status: 422 }));
    return noStore(Response.json(result, { status: result.status === "PENDING" ? 202 : 200 }));
  } catch (error) {
    if (error instanceof PaymentError) return noStore(Response.json({ error: { code: error.code, message: error.message } }, { status: error.status }));
    return noStore(Response.json({ error: { code: "PAYMENT_RECOVERY_REQUIRED", message: "Payment processing is incomplete. Retry confirmation with the same attempt." } }, { status: 503 }));
  }
}
