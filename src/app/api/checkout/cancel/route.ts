import type { NextRequest } from "next/server";
import { readJsonBody } from "@/lib/auth/http";
import { requireRole } from "@/lib/auth/requireRole";
import { createAdminClient } from "@/lib/supabase/admin";
import { cancelCustomerPayments } from "@/lib/payments/finalize-backend";
import { PaymentError } from "@/lib/payments/service";

export const runtime = "nodejs";
const noStore = (response: Response) => { response.headers.set("Cache-Control", "no-store"); return response; };

/** Cancels the session customer's unauthorized payment so checkout can start over. */
export async function POST(request: NextRequest): Promise<Response> {
  try {
    const db = createAdminClient();
    const auth = await requireRole(request, db, ["CUSTOMER"]);
    if (!auth.ok) return noStore(auth.response);
    // The body is unused, but requiring JSON blocks cross-site form posts.
    const json = await readJsonBody(request);
    if (!json.ok) return noStore(json.response);
    return noStore(Response.json(await cancelCustomerPayments(db, auth.user.id)));
  } catch (error) {
    if (error instanceof PaymentError) return noStore(Response.json({ error: { code: error.code, message: error.message } }, { status: error.status }));
    return noStore(Response.json({ error: { code: "PAYMENT_RECOVERY_REQUIRED", message: "Payment cancellation is incomplete. Try again." } }, { status: 503 }));
  }
}
