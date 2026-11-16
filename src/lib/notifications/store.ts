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
  claimToken: string;
};

export type NotificationStore = {
  /** Leases up to `limit` unsent rows so no other sender picks them up. */
  claim(limit: number): Promise<ClaimedNotification[]>;
  loadOrder(orderId: string): Promise<OrderSummary | null>;
  markSent(id: string, claimToken: string): Promise<void>;
  markFailed(id: string, message: string, claimToken: string): Promise<void>;
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
  claim_token: string;
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
        claimToken: row.claim_token,
      }));
    },

    // Orders belong to the Order service, so read them through its API.
    loadOrder(orderId) {
      return getOrderSummary(db, orderId);
    },

    async markSent(id, claimToken) {
      const { error } = await db.rpc("finish_notification", { p_id:id,p_token:claimToken,p_error:null });
      if (error) throw new Error(`marking notification ${id} sent failed: ${error.message}`);
    },

    async markFailed(id, message, claimToken) {
      const { error } = await db.rpc("finish_notification", { p_id:id,p_token:claimToken,p_error:message.slice(0,MAX_ERROR_LENGTH) });
      if (error) throw new Error(`marking notification ${id} failed: ${error.message}`);
    },
  };
}
