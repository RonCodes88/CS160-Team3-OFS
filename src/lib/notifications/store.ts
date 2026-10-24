import type { SupabaseClient } from "@supabase/supabase-js";
import type { NotificationType, OrderSummary } from "@/lib/notifications/messages";
import { getOrderSummary } from "@/lib/orders/read";

// Database side of the notification outbox (see the notification_outbox migration).

export type ClaimedNotification = {
  id: string;
  orderId: string;
  type: NotificationType;
  recipientEmail: string;
  payload: Record<string, unknown>;
  attempts: number;
};

export type NotificationStore = {
  /** Leases up to `limit` unsent rows so no other sender picks them up. */
  claim(limit: number): Promise<ClaimedNotification[]>;
  loadOrder(orderId: string): Promise<OrderSummary | null>;
  markSent(id: string): Promise<void>;
  markFailed(id: string, message: string): Promise<void>;
};

/** Failed rows are retried until they have been attempted this many times. */
export const MAX_ATTEMPTS = 3;

const MAX_ERROR_LENGTH = 500;

type NotificationRow = {
  id: string;
  order_id: string;
  notification_type: NotificationType;
  recipient_email: string;
  payload: Record<string, unknown> | null;
  attempts: number;
};

export function createNotificationStore(db: SupabaseClient): NotificationStore {
  return {
    async claim(limit) {
      const { data, error } = await db.rpc("claim_notifications", {
        p_limit: limit,
        p_max_attempts: MAX_ATTEMPTS,
      });
      if (error) throw new Error(`claim_notifications failed: ${error.message}`);
      return (data as NotificationRow[]).map((row) => ({
        id: row.id,
        orderId: row.order_id,
        type: row.notification_type,
        recipientEmail: row.recipient_email,
        payload: row.payload ?? {},
        attempts: row.attempts,
      }));
    },

    // Orders belong to the Order service, so read them through its API.
    loadOrder(orderId) {
      return getOrderSummary(db, orderId);
    },

    async markSent(id) {
      const { error } = await db
        .from("notifications")
        .update({ status: "SENT", sent_at: new Date().toISOString(), error_message: null, locked_until: null })
        .eq("id", id);
      if (error) throw new Error(`marking notification ${id} sent failed: ${error.message}`);
    },

    async markFailed(id, message) {
      const { error } = await db
        .from("notifications")
        .update({ status: "FAILED", error_message: message.slice(0, MAX_ERROR_LENGTH), locked_until: null })
        .eq("id", id);
      if (error) throw new Error(`marking notification ${id} failed: ${error.message}`);
    },
  };
}
