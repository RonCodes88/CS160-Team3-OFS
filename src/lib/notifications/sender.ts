// How a rendered notification reaches the customer. Only the sender changes
// when the team picks an email provider; queueing and retries stay the same.

export type OutgoingMessage = { to: string; subject: string; text: string };

export type NotificationSender = { send(message: OutgoingMessage): Promise<void> };

/** Development sender: prints the message to the server log instead of emailing it. */
export const logSender: NotificationSender = {
  async send({ to, subject, text }) {
    console.info(`[notification] to=${to} subject="${subject}"\n${text}`);
  },
};

/** The sender the app uses. Replace with a real email provider once one is chosen. */
export function getNotificationSender(): NotificationSender {
  return logSender;
}
