// Provider acknowledgement means accepted for delivery, not inbox delivery.
export type OutgoingMessage = {
  to: string;
  subject: string;
  text: string;
};

export type NotificationSender = {
  send(message: OutgoingMessage, notificationId?: string): Promise<void>;
};

/** Plain fetch keeps the provider outside the queue and adds no dependency. */
export function createResendSender(apiKey: string, from: string, fetcher: typeof fetch = fetch): NotificationSender {
  return {
    async send(message, notificationId) {
      if (!notificationId) {
        throw new Error("NOTIFICATION_ID_REQUIRED");
      }
      try {
        const response = await fetcher("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            "Idempotency-Key": `ofs:notification:${notificationId}`
          },
          body: JSON.stringify({
            from,
            to: [message.to],
            subject: message.subject,
            text: message.text
          }),
          signal: AbortSignal.timeout(10000)
        });
        if (!response.ok) {
          throw new Error("Rejected");
        }
        const body: unknown = await response.json();
        if (typeof body !== "object" || body === null || !("id" in body) || typeof body.id !== "string" || !body.id) {
          throw new Error("Unconfirmed");
        }
      } catch {
        // Do not store or log provider response bodies, bearer keys, or addresses.
        throw new Error("EMAIL_PROVIDER_UNAVAILABLE");
      }
    },
  };
}

/** Disabled by default. Missing configuration never consumes queued messages. */
export function getNotificationSender(): NotificationSender {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.OFS_EMAIL_FROM;
  if (process.env.OFS_EMAIL_PROVIDER === "resend" && key && /^re_[A-Za-z0-9_-]+$/.test(key)
    && from && !/[\r\n\0]/.test(from) && /[^\s<>]+@[^\s<>]+\.[^\s<>]+/.test(from)) {
    return createResendSender(key, from);
  }
  throw new Error("NOTIFICATIONS_NOT_CONFIGURED");
}
