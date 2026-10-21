import type { SupabaseClient } from "@supabase/supabase-js";
import { PaymentError, type NewAttempt, type PaymentAttempt } from "./service";

/** Service-role access is always scoped to the authenticated customer. */
export function paymentRepository(db: SupabaseClient) {
  return {
    async find(customerId: string, key: string): Promise<PaymentAttempt | null> {
      const { data, error } = await db.from("payment_attempts").select("*")
        .eq("customer_id", customerId).eq("idempotency_key", key).maybeSingle();
      if (error) throw new Error("Payment lookup failed");
      return data as PaymentAttempt | null;
    },
    async reserve(attempt: NewAttempt): Promise<PaymentAttempt> {
      const { data, error } = await db.rpc("checkout_reserve_payment_attempt", { p_attempt: attempt });
      if (error?.code === "P0010") throw new PaymentError(409, "PAYMENT_IN_PROGRESS", "A payment is already in progress for this cart. Resume that payment.");
      if (error?.code === "P0011") throw new PaymentError(409, "CHECKOUT_CHANGED", "Your cart or address is no longer available.");
      if (error) throw new Error("Payment reservation failed");
      return data as PaymentAttempt;
    },
    async attach(customerId: string, attemptId: string, providerId: string): Promise<void> {
      const { error } = await db.rpc("checkout_attach_payment_intent", {
        p_customer_id: customerId, p_attempt_id: attemptId, p_provider_id: providerId,
      });
      if (error) throw new Error("Payment provider link failed");
    },
  };
}
