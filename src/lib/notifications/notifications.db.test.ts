import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { NotificationSender, OutgoingMessage } from "@/lib/notifications/sender";
import { processPendingNotifications } from "@/lib/notifications/service";
import { createNotificationStore, MAX_ATTEMPTS } from "@/lib/notifications/store";

// Runs the notification triggers and sender against a LOCAL Supabase with the
// migrations applied. Setup: `npx supabase start`, then put SUPABASE_TEST_URL
// and SUPABASE_TEST_SECRET_KEY in .env.test.local. Skipped when not configured.
try {
  process.loadEnvFile(".env.test.local");
} catch {
  // Optional file.
}

const TEST_URL = process.env.SUPABASE_TEST_URL;
const TEST_KEY = process.env.SUPABASE_TEST_SECRET_KEY;

// host.docker.internal is the developer's own machine when tests run in Docker.
if (
  TEST_URL &&
  !/^http:\/\/(localhost|127\.0\.0\.1|host\.docker\.internal)(:\d+)?\/?$/.test(TEST_URL)
) {
  throw new Error(`Refusing to run DB tests against non-local SUPABASE_TEST_URL: ${TEST_URL}`);
}

const run = randomUUID().slice(0, 8);
const POINT = "SRID=4326;POINT(-121.8863 37.3382)";
const EMAIL = `notify-${run}@test.local`;

type NotificationRow = {
  id: string;
  order_id: string;
  customer_id: string;
  notification_type: string;
  recipient_email: string;
  status: string;
  attempts: number;
  sent_at: string | null;
  error_message: string | null;
  payload: Record<string, unknown>;
};

describe.skipIf(!TEST_URL || !TEST_KEY)("notifications against Postgres", () => {
  let db: SupabaseClient;
  let customerId: string;
  let productId: string;
  let categoryId: string;
  const orderIds: string[] = [];
  const tripIds: string[] = [];

  async function insertOne<T>(table: string, row: object): Promise<T> {
    const { data, error } = await db.from(table).insert(row).select().single();
    if (error) throw new Error(`${table} insert failed: ${error.message}`);
    return data as T;
  }

  async function newOrder() {
    const order = await insertOne<{ id: string }>("orders", {
      customer_id: customerId,
      delivery_address: { line_1: "211 S 1st St", city: "San Jose", state: "CA", postal_code: "95113" },
      location: POINT,
      subtotal_cents: 898,
      total_cents: 898,
      total_weight: 1720,
    });
    orderIds.push(order.id);
    const { error } = await db.from("order_items").insert({
      order_id: order.id,
      product_id: productId,
      sku: `MILK-${run}`,
      product_name: "Whole Milk",
      unit_price_cents: 449,
      unit_weight: 860,
      quantity: 2,
    });
    if (error) throw error;
    return order.id;
  }

  async function setStatus(orderId: string, status: string) {
    const { error } = await db.from("order_status_history").insert({ order_id: orderId, status });
    expect(error).toBeNull();
  }

  async function newStop(orderId: string, estimatedArrival: string | null) {
    const trip = await insertOne<{ id: string }>("trips", {});
    tripIds.push(trip.id);
    return insertOne<{ id: string }>("delivery_stops", {
      trip_id: trip.id,
      order_id: orderId,
      stop_sequence: 1,
      location: POINT,
      estimated_arrival: estimatedArrival,
    });
  }

  async function updateStop(stopId: string, changes: object) {
    const { error } = await db.from("delivery_stops").update(changes).eq("id", stopId);
    expect(error).toBeNull();
  }

  async function notificationsFor(orderId: string) {
    const { data, error } = await db
      .from("notifications")
      .select("*")
      .eq("order_id", orderId)
      .order("created_at");
    if (error) throw error;
    return data as NotificationRow[];
  }

  /** Captures messages to this test's customer; can be told to fail. */
  function testSender(fail = false) {
    const sent: OutgoingMessage[] = [];
    const sender: NotificationSender = {
      async send(message) {
        if (message.to !== EMAIL) return; // rows queued by other test files
        if (fail) throw new Error("provider unavailable");
        sent.push(message);
      },
    };
    return { sender, sent };
  }

  const runSender = (sender: NotificationSender) =>
    processPendingNotifications(createNotificationStore(db), sender, { limit: 100 });

  beforeAll(async () => {
    db = createClient(TEST_URL!, TEST_KEY!, { auth: { persistSession: false } });
    customerId = (await insertOne<{ id: string }>("users", { email: EMAIL, password_hash: "test-only" })).id;
    categoryId = (await insertOne<{ id: string }>("categories", { name: `Notify ${run}`, slug: `notify-${run}` })).id;
    productId = (
      await insertOne<{ id: string }>("products", {
        sku: `MILK-${run}`,
        category_id: categoryId,
        name: "Whole Milk",
        price_cents: 449,
        unit_weight: 860,
      })
    ).id;
  });

  afterAll(async () => {
    if (!db) return;
    await db.from("trips").delete().in("id", tripIds); // stops cascade
    await db.from("orders").delete().in("id", orderIds); // items, history, notifications cascade
    await db.from("products").delete().eq("id", productId);
    await db.from("categories").delete().eq("id", categoryId);
    await db.from("users").delete().eq("id", customerId);
  });

  describe("order confirmation (#35)", () => {
    it("queues one confirmation for the customer when the order is paid", async () => {
      const orderId = await newOrder();
      await setStatus(orderId, "PAID");

      const rows = await notificationsFor(orderId);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        notification_type: "ORDER_CONFIRMED",
        customer_id: customerId,
        recipient_email: EMAIL,
        status: "PENDING",
        attempts: 0,
      });
    });

    it("never queues a second confirmation for the same order", async () => {
      const orderId = await newOrder();
      await setStatus(orderId, "PAID");
      await setStatus(orderId, "PAID");
      expect(await notificationsFor(orderId)).toHaveLength(1);
    });

    it("sends the receipt with order number, items, total and address, then marks it SENT", async () => {
      const orderId = await newOrder();
      await setStatus(orderId, "PAID");
      const { sender, sent } = testSender();

      await runSender(sender);

      const mine = sent.find((m) => m.subject.includes(`#${orderId.replace(/-/g, "").slice(0, 8).toUpperCase()}`));
      expect(mine?.text).toContain("2 × Whole Milk  $8.98");
      expect(mine?.text).toContain("Total charged: $8.98");
      expect(mine?.text).toContain("211 S 1st St\nSan Jose, CA 95113");
      const [row] = await notificationsFor(orderId);
      expect(row).toMatchObject({ status: "SENT", attempts: 1, error_message: null });
      expect(row.sent_at).not.toBeNull();
    });

    it("does not queue anything for internal steps like PREPARING or BATCHED", async () => {
      const orderId = await newOrder();
      await setStatus(orderId, "PREPARING");
      await setStatus(orderId, "BATCHED");
      expect(await notificationsFor(orderId)).toEqual([]);
    });
  });

  describe("delivery notifications (#36)", () => {
    it("queues READY_FOR_DELIVERY when the trip goes out and DELIVERED at the end, once each", async () => {
      const orderId = await newOrder();
      await setStatus(orderId, "OUT_FOR_DELIVERY");
      await setStatus(orderId, "OUT_FOR_DELIVERY");
      await setStatus(orderId, "DELIVERED");

      const types = (await notificationsFor(orderId)).map((n) => n.notification_type);
      expect(types).toEqual(["READY_FOR_DELIVERY", "DELIVERED"]);
    });

    it("queues an update when the ETA moves 5+ minutes, but not for the first ETA or small wobbles", async () => {
      const orderId = await newOrder();
      const stop = await newStop(orderId, null);

      await updateStop(stop.id, { estimated_arrival: "2026-10-20T19:40:00Z" }); // first ETA
      await updateStop(stop.id, { estimated_arrival: "2026-10-20T19:42:00Z" }); // 2 min wobble
      expect(await notificationsFor(orderId)).toEqual([]);

      await updateStop(stop.id, { estimated_arrival: "2026-10-20T19:55:00Z" }); // 13 min later

      const rows = await notificationsFor(orderId);
      expect(rows).toHaveLength(1);
      expect(rows[0].notification_type).toBe("DELIVERY_UPDATE");
      expect(rows[0].payload).toMatchObject({ reason: "ETA_CHANGED" });
      expect(Date.parse(rows[0].payload.estimated_arrival as string)).toBe(Date.parse("2026-10-20T19:55:00Z"));
      expect(Date.parse(rows[0].payload.previous_estimated_arrival as string)).toBe(
        Date.parse("2026-10-20T19:42:00Z"),
      );
    });

    it("queues an update for DELAYED and ARRIVED stops, but not for EN_ROUTE", async () => {
      const orderId = await newOrder();
      const stop = await newStop(orderId, "2026-10-20T19:40:00Z");

      await updateStop(stop.id, { status: "EN_ROUTE" });
      await updateStop(stop.id, { status: "DELAYED" });
      await updateStop(stop.id, { status: "ARRIVED" });

      const reasons = (await notificationsFor(orderId)).map((n) => n.payload.reason);
      expect(reasons).toEqual(["DELAYED", "ARRIVED"]);
    });
  });

  describe("failures never block orders or deliveries", () => {
    it("queueing problems are swallowed instead of failing the caller", async () => {
      const orderId = await newOrder();
      const { error } = await db.rpc("queue_order_notification", {
        p_order_id: orderId,
        p_type: "NOT_A_REAL_TYPE",
        p_payload: {},
      });
      expect(error).toBeNull();
      expect(await notificationsFor(orderId)).toEqual([]);
    });

    it("a failed send is recorded and retried, and the order is untouched", async () => {
      const orderId = await newOrder();
      await setStatus(orderId, "PAID");

      await runSender(testSender(true).sender);
      let [row] = await notificationsFor(orderId);
      expect(row).toMatchObject({ status: "FAILED", attempts: 1, error_message: "provider unavailable" });
      await setStatus(orderId, "PREPARING"); // the order keeps moving

      await runSender(testSender().sender);
      [row] = await notificationsFor(orderId);
      expect(row).toMatchObject({ status: "SENT", attempts: 2, error_message: null });
    });

    it(`gives up after ${MAX_ATTEMPTS} attempts`, async () => {
      const orderId = await newOrder();
      await setStatus(orderId, "PAID");
      const failing = testSender(true).sender;

      for (let i = 0; i < MAX_ATTEMPTS + 1; i++) await runSender(failing);

      const [row] = await notificationsFor(orderId);
      expect(row).toMatchObject({ status: "FAILED", attempts: MAX_ATTEMPTS });
    });

    it("two senders never claim the same notification", async () => {
      const orderId = await newOrder();
      await setStatus(orderId, "PAID");
      const [row] = await notificationsFor(orderId);

      const first = await db.rpc("claim_notifications", { p_limit: 100 });
      const second = await db.rpc("claim_notifications", { p_limit: 100 });

      const ids = (result: { data: unknown }) => (result.data as { id: string }[]).map((n) => n.id);
      expect(ids(first)).toContain(row.id);
      expect(ids(second)).not.toContain(row.id);
    });
  });
});
