import { renderMessage } from "@/lib/notifications/messages";
import { getNotificationSender, type NotificationSender } from "@/lib/notifications/sender";
import { createNotificationStore, type NotificationStore } from "@/lib/notifications/store";
import { createAdminClient } from "@/lib/supabase/admin";

// Delivers queued notifications. Rows are queued by database triggers when an
// order is paid, dispatched, delivered, or its delivery stop changes, so the
// order and delivery code never waits on (or fails because of) sending.

export type ProcessResult = { sent: number; failed: number };

export const DEFAULT_BATCH_SIZE = 20;

/**
 * Sends one batch of queued notifications. Each row is handled on its own:
 * one bad row is marked FAILED (and retried later) without stopping the rest.
 */
export async function processPendingNotifications(
  store: NotificationStore,
  sender: NotificationSender,
  { limit = DEFAULT_BATCH_SIZE }: { limit?: number } = {},
): Promise<ProcessResult> {
  const batch = await store.claim(limit);
  const result: ProcessResult = { sent: 0, failed: 0 };

  for (const notification of batch) {
    try {
      const order = await store.loadOrder(notification.orderId);
      if (!order) throw new Error(`order ${notification.orderId} not found`);
      const { subject, text } = renderMessage(notification.type, notification.payload, order);
      await sender.send({ to: notification.recipientEmail, subject, text });
      await store.markSent(notification.id);
      result.sent += 1;
    } catch (err) {
      result.failed += 1;
      const message = err instanceof Error ? err.message : String(err);
      try {
        await store.markFailed(notification.id, message);
      } catch (markError) {
        // The lease expires on its own, so the row is retried even if this write fails.
        console.error(markError);
      }
    }
  }
  return result;
}

/**
 * Entry point for whatever runs the sender: e.g. the batching job that already
 * runs every minute, or a call right after checkout commits.
 */
export async function sendPendingNotifications(limit = DEFAULT_BATCH_SIZE): Promise<ProcessResult> {
  return processPendingNotifications(createNotificationStore(createAdminClient()), getNotificationSender(), {
    limit,
  });
}
