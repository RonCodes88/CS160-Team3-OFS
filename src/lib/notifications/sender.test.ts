import { afterEach, describe, expect, it, vi } from "vitest";
import { createResendSender, getNotificationSender } from "./sender";
import { sendPendingNotifications } from "./service";

const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc }) }));
afterEach(() => vi.unstubAllEnvs());
const message = {
  to: "customer@example.test",
  subject: "Order confirmed",
  text: "Receipt"
};
describe("email provider boundary", () => {
  it("does not claim or mark notifications sent while email is disabled", async () => {
    vi.stubEnv("OFS_EMAIL_PROVIDER", "disabled");
    rpc.mockClear();
    await expect(sendPendingNotifications()).rejects.toThrow("NOTIFICATIONS_NOT_CONFIGURED");
    expect(rpc).not.toHaveBeenCalled();
  });
  it("rejects disabled or missing configuration before messages are claimed", () => {
    vi.stubEnv("OFS_EMAIL_PROVIDER", "disabled");
    expect(() => getNotificationSender()).toThrow("NOTIFICATIONS_NOT_CONFIGURED");
    vi.stubEnv("OFS_EMAIL_PROVIDER", "resend");
    vi.stubEnv("RESEND_API_KEY", "");
    expect(() => getNotificationSender()).toThrow("NOTIFICATIONS_NOT_CONFIGURED");
  });
  it("uses a stable notification key and checks provider acknowledgement", async () => {
    const fetcher = vi.fn(async () => Response.json({ id: "email_id" }));
    const sender = createResendSender("re_test", "orders@example.test", fetcher);
    await sender.send(message, "notification");
    expect(fetcher).toHaveBeenCalledWith("https://api.resend.com/emails", expect.objectContaining({
      headers: expect.objectContaining({
        Authorization: "Bearer re_test",
        "Idempotency-Key": "ofs:notification:notification"
      }),
      body: JSON.stringify({
        from: "orders@example.test",
        to: [message.to],
        subject: message.subject,
        text: message.text
      })
    }));
  });
  it.each([429, 500, 401])("rejects HTTP %i without leaking provider content", async (status) => {
    const sender = createResendSender("re_secret", "orders@example.test", vi.fn(async () => new Response("private provider content", { status })));
    await expect(sender.send(message, "notification")).rejects.toThrow("EMAIL_PROVIDER_UNAVAILABLE");
  });
  it("treats a malformed success response as uncertain and retries with the same key", async () => {
    const sender = createResendSender("re_test", "orders@example.test", vi.fn(async () => Response.json({})));
    await expect(sender.send(message, "notification")).rejects.toThrow("EMAIL_PROVIDER_UNAVAILABLE");
  });
  it("sanitizes network failures and requires the outbox identity", async () => {
    const fetcher = vi.fn(async () => { throw new Error("Bearer secret"); });
    const sender = createResendSender("re_test", "orders@example.test", fetcher);
    await expect(sender.send(message, "notification")).rejects.toThrow("EMAIL_PROVIDER_UNAVAILABLE");
    await expect(sender.send(message)).rejects.toThrow("NOTIFICATION_ID_REQUIRED");
  });
});
