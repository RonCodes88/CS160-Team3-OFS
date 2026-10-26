import { randomBytes, randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as readCart } from "@/app/api/cart/route";
import { POST as prepare } from "@/app/api/checkout/payment-intent/route";
import { hashSessionToken, SESSION_COOKIE } from "@/lib/auth/session";
import { confirmCustomerPayment, finalizeWebhookPayment } from "./finalize-backend";
import type { FinalizationIntent } from "./finalize";
import { createCustomerPaymentIntent } from "./backend";

const stripe = vi.hoisted(() => ({ paymentIntents: { create: vi.fn(), retrieve: vi.fn(), capture: vi.fn(), cancel: vi.fn() },
  refunds: { list: vi.fn(), create: vi.fn() } }));
vi.mock("./stripe", async (original) => ({ ...await original<typeof import("./stripe")>(), createStripeClient: () => stripe }));
try { process.loadEnvFile(".env.test.local"); } catch { /* Optional test-only configuration. */ }
const url = process.env.SUPABASE_TEST_URL, key = process.env.SUPABASE_TEST_SECRET_KEY;
if (url && !/^http:\/\/(localhost|127\.0\.0\.1|host\.docker\.internal)(:\d+)?\/?$/.test(url)) throw new Error("Use a separate local test DB.");

describe.skipIf(!url || !key)("payment finalization against Postgres (Stripe mocked)", () => {
  let db: SupabaseClient, attemptId: string, providerId: string;
  const customer = randomUUID(), category = randomUUID(), product = randomUUID(), cart = randomUUID(), address = randomUUID();
  const token = randomBytes(32).toString("hex");
  const expected = { subtotalCents: 500, totalWeight: 2000, deliveryFeeCents: 1000, taxCents: 25, totalCents: 1525 };
  const intents = new Map<string, FinalizationIntent>();
  const refunds: { id: string; amount: number; currency: string; status: string; metadata: { attemptId: string } }[] = [];
  const extraCustomers: string[] = [];
  async function insert(table: string, row: object) {
    const { error } = await db.from(table).insert(row); if (error) throw error;
  }
  async function update(table: string, id: string, row: object) {
    const { error } = await db.from(table).update(row).eq("id", id); if (error) throw error;
  }
  async function rows(table: string, column: string, id: string) {
    const { data, error } = await db.from(table).select("*").eq(column, id); if (error) throw error; return data!;
  }
  async function cleanupPayments() {
    for (const table of ["payment_attempts", "orders"]) {
      const { error } = await db.from(table).delete().eq("customer_id", customer); if (error) throw error;
    }
  }
  const confirm = () => confirmCustomerPayment(db, customer, attemptId, "checkout-test");
  beforeAll(async () => {
    db = createClient(url!, key!, { auth: { persistSession: false } });
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", url!); vi.stubEnv("SUPABASE_SECRET_KEY", key!);
    vi.stubEnv("OFS_STORE_LATITUDE", "0"); vi.stubEnv("OFS_STORE_LONGITUDE", "0"); vi.stubEnv("OFS_DELIVERY_RADIUS_METERS", "1000");
    await insert("users", { id: customer, email: `${customer}@finalize.test`, password_hash: "test-only", role: "CUSTOMER" });
    await insert("auth_sessions", { user_id: customer, token_hash: hashSessionToken(token), expires_at: new Date(Date.now()+3600_000).toISOString() });
    await insert("categories", { id: category, name: "Finalize test", slug: category });
    await insert("products", { id: product, category_id: category, sku: product, name: "Test", price_cents: 250, unit_weight: 1000, stock_quantity: 2 });
    await insert("carts", { id: cart, customer_id: customer });
    await insert("cart_items", { cart_id: cart, product_id: product, quantity: 2 });
    await insert("addresses", { id: address, customer_id: customer, line_1: "Test", city: "Test", state: "CA", postal_code: "00000", location: "SRID=4326;POINT(0 0)" });
  });
  beforeEach(async () => {
    vi.clearAllMocks(); intents.clear(); refunds.length = 0;
    await cleanupPayments();
    // A completed checkout can create a fresh active cart through GET /api/cart.
    const removed = await db.from("carts").delete().eq("customer_id", customer).neq("id", cart);
    if (removed.error) throw removed.error;
    await update("carts", cart, { status: "ACTIVE" });
    const restored = await db.from("cart_items").update({ quantity: 2 }).eq("cart_id",cart); if (restored.error) throw restored.error;
    await update("products", product, { stock_quantity: 2, price_cents: 250, unit_weight: 1000, is_active: true });
    stripe.paymentIntents.create.mockImplementation(async (params) => {
      const intent = { id: `pi_${params.metadata.attemptId}`, client_secret: "test-secret", status: "requires_capture", amount: params.amount,
        amount_received: 0, amount_capturable: params.amount, currency: "usd", livemode: false, capture_method: "manual", metadata: params.metadata };
      intents.set(intent.id, intent); return { ...intent };
    });
    stripe.paymentIntents.retrieve.mockImplementation(async (id) => ({ ...intents.get(id)! }));
    stripe.paymentIntents.capture.mockImplementation(async (id) => {
      const intent = intents.get(id)!; Object.assign(intent, { status: "succeeded", amount_received: intent.amount, amount_capturable: 0 }); return { ...intent };
    });
    stripe.paymentIntents.cancel.mockImplementation(async (id) => { const intent = intents.get(id)!; intent.status = "canceled"; return { ...intent }; });
    stripe.refunds.list.mockImplementation(async () => ({ data: [...refunds] }));
    stripe.refunds.create.mockImplementation(async (params) => {
      const refund = { id: `re_${params.metadata.attemptId}`, amount: params.amount, currency: "usd", status: "succeeded", metadata: params.metadata };
      refunds.push(refund); return refund;
    });
    const response = await prepare(new NextRequest("http://localhost/api/checkout/payment-intent", { method: "POST",
      headers: { "content-type": "application/json", "Idempotency-Key": "checkout-test", cookie: `${SESSION_COOKIE}=${token}` },
      body: JSON.stringify({ addressId: address, expected }) }));
    expect(response.status).toBe(200);
    const prepared = await response.json(); attemptId = prepared.attemptId; providerId = prepared.paymentIntentId;
  });
  afterAll(async () => {
    try {
      if (db) {
        for (const other of extraCustomers) {
          for (const table of ["payment_attempts","orders","carts","addresses"]) {
            const { error }=await db.from(table).delete().eq("customer_id",other); if(error) throw error;
          }
          const { error }=await db.from("users").delete().eq("id",other); if(error) throw error;
        }
        await cleanupPayments();
        for (const [table,id] of [["carts",cart],["addresses",address],["products",product],["categories",category],["users",customer]]) {
          const { error } = await db.from(table).delete().eq("id", id); if (error) throw error;
        }
      }
    } finally { vi.unstubAllEnvs(); }
  });

  it("atomically creates snapshots, decrements stock, checks out cart and queues one notification", async () => {
    const result = await confirm(); expect(result.status).toBe("CAPTURED");
    expect((await rows("orders","id",result.orderId!))[0]).toMatchObject({ total_cents: 1525, tax_cents: 25, delivery_address: { line_1: "Test" } });
    expect((await rows("order_items","order_id",result.orderId!))[0]).toMatchObject({ quantity: 2, unit_price_cents: 250 });
    expect((await rows("products","id",product))[0].stock_quantity).toBe(0);
    expect((await rows("carts","id",cart))[0].status).toBe("CHECKED_OUT");
    expect(await rows("order_status_history","order_id",result.orderId!)).toHaveLength(1);
    expect(await rows("notifications","order_id",result.orderId!)).toHaveLength(1);
  });
  describe("#20 order creation acceptance", () => {
    it.each(["requires_payment_method", "requires_action", "processing"])(
      "does not create an order while payment is %s", async (status) => {
        Object.assign(intents.get(providerId)!, { status, amount_capturable: 0 });
        expect(await confirm()).toMatchObject({ status: "PENDING" });
        expect(stripe.paymentIntents.capture).not.toHaveBeenCalled();
        expect(await rows("orders", "customer_id", customer)).toHaveLength(0);
        expect(await rows("order_items", "product_id", product)).toHaveLength(0);
        expect((await rows("carts", "id", cart))[0].status).toBe("ACTIVE");
      },
    );

    it("waits for successful capture and links the complete snapshot to the customer and Stripe payment", async () => {
      stripe.paymentIntents.capture.mockImplementationOnce(async (id) => {
        expect(await rows("orders", "customer_id", customer)).toHaveLength(0);
        expect(await rows("order_items", "product_id", product)).toHaveLength(0);
        const intent = intents.get(id)!;
        Object.assign(intent, { status: "succeeded", amount_received: intent.amount, amount_capturable: 0 });
        return { ...intent };
      });
      const result = await confirm();
      expect(result.status).toBe("CAPTURED");
      const orders = await rows("orders", "customer_id", customer);
      expect(orders).toHaveLength(1);
      expect(orders[0]).toMatchObject({ id: result.orderId, customer_id: customer, status: "PAID",
        subtotal_cents: 500, total_weight: 2000, delivery_fee_cents: 1000, tax_cents: 25, total_cents: 1525,
        address_id: address, delivery_address: { line_1: "Test", line_2: null, city: "Test", state: "CA", postal_code: "00000" } });
      expect(orders[0].paid_at).toBeTruthy();
      const items = await rows("order_items", "order_id", result.orderId!);
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({ product_id: product, sku: product, product_name: "Test",
        quantity: 2, unit_price_cents: 250, unit_weight: 1000 });
      expect((await rows("payment_attempts", "id", attemptId))[0]).toMatchObject({
        customer_id: customer, order_id: result.orderId, provider_payment_id: providerId, status: "CAPTURED",
      });
    });

    it("preserves order snapshots after catalog and saved-address edits", async () => {
      const result = await confirm();
      const originalOrder = await rows("orders", "id", result.orderId!);
      const originalItems = await rows("order_items", "order_id", result.orderId!);
      try {
        await update("products", product, { name: "Changed product", price_cents: 999, unit_weight: 50 });
        await update("addresses", address, { line_1: "Changed street", city: "Changed city",
          postal_code: "99999", location: "SRID=4326;POINT(1 1)" });
        expect(await rows("orders", "id", result.orderId!)).toEqual(originalOrder);
        expect(await rows("order_items", "order_id", result.orderId!)).toEqual(originalItems);
      } finally {
        await update("products", product, { name: "Test", price_cents: 250, unit_weight: 1000 });
        await update("addresses", address, { line_1: "Test", city: "Test", postal_code: "00000",
          location: "SRID=4326;POINT(0 0)" });
      }
    });

    it("returns an empty active cart through the authenticated API after checkout", async () => {
      const result = await confirm();
      const response = await readCart(new NextRequest("http://localhost/api/cart", {
        headers: { cookie: `${SESSION_COOKIE}=${token}` },
      }));
      expect(response.status).toBe(200);
      const fresh = await response.json();
      expect(fresh.cart_id).not.toBe(cart);
      expect(fresh).toMatchObject({ items: [], total_weight: 0, subtotal_cents: 0,
        delivery_fee_cents: 0, total_cents: 0 });
      expect((await rows("carts", "id", fresh.cart_id))[0]).toMatchObject({ customer_id: customer, status: "ACTIVE" });
      expect((await rows("carts", "id", cart))[0].status).toBe("CHECKED_OUT");
      expect(await confirm()).toEqual(result);
      expect(await rows("cart_items", "cart_id", fresh.cart_id)).toHaveLength(0);
      expect(await rows("orders", "customer_id", customer)).toHaveLength(1);
    });
  });

  it("browser and webhook repeats return one order with one capture", async () => {
    const first = await confirm(); expect(await finalizeWebhookPayment(db,providerId)).toEqual(first);
    expect(await confirm()).toEqual(first);
    expect(stripe.paymentIntents.capture).toHaveBeenCalledTimes(1);
    expect(await rows("orders","customer_id",customer)).toHaveLength(1);
  });
  it("concurrent callers never create two orders", async () => {
    const results = await Promise.allSettled([confirm(),finalizeWebhookPayment(db,providerId)]);
    expect(results.some((r) => r.status === "fulfilled")).toBe(true);
    expect((await confirm()).orderId).toBeTruthy();
    expect(await rows("orders","customer_id",customer)).toHaveLength(1);
    expect(stripe.paymentIntents.capture).toHaveBeenCalledTimes(1);
  });
  it("declined payments do not capture or create an order", async () => {
    Object.assign(intents.get(providerId)!, { status: "requires_payment_method", last_payment_error: { code: "card_declined" } });
    expect(await confirm()).toMatchObject({ status: "PENDING", failureCode: "PAYMENT_DECLINED" });
    expect(stripe.paymentIntents.capture).not.toHaveBeenCalled(); expect(await rows("orders","customer_id",customer)).toHaveLength(0);
  });
  it("voids an authorization when stock is gone before capture", async () => {
    await update("products",product,{ stock_quantity: 0 });
    expect(await confirm()).toMatchObject({ status: "VOIDED", failureCode: "INSUFFICIENT_STOCK" });
    expect(stripe.paymentIntents.capture).not.toHaveBeenCalled(); expect(await rows("orders","customer_id",customer)).toHaveLength(0);
  });
  it("refunds if stock changes during capture without partial order writes", async () => {
    stripe.paymentIntents.capture.mockImplementationOnce(async (id) => {
      await update("products",product,{ stock_quantity: 0 });
      const intent = intents.get(id)!; Object.assign(intent,{ status: "succeeded", amount_received: 1525 }); return { ...intent };
    });
    expect(await confirm()).toMatchObject({ status: "REFUNDED", failureCode: "INSUFFICIENT_STOCK" });
    expect(await rows("orders","customer_id",customer)).toHaveLength(0);
    expect((await rows("carts","id",cart))[0].status).toBe("ACTIVE");
    expect(await confirm()).toMatchObject({ status: "REFUNDED" }); expect(stripe.refunds.create).toHaveBeenCalledTimes(1);
  });
  it("recovers a timeout after Stripe captured without capturing twice", async () => {
    stripe.paymentIntents.capture.mockImplementationOnce(async (id) => {
      Object.assign(intents.get(id)!,{ status: "succeeded", amount_received: 1525 }); throw new Error("response lost");
    });
    await expect(confirm()).rejects.toThrow();
    expect((await confirm()).orderId).toBeTruthy(); expect(stripe.paymentIntents.capture).toHaveBeenCalledTimes(1);
  });
  it("blocks foreign customers and mismatched confirmation keys", async () => {
    await expect(confirmCustomerPayment(db,randomUUID(),attemptId,"checkout-test")).rejects.toMatchObject({ status: 404 });
    await expect(confirmCustomerPayment(db,customer,attemptId,"different-key")).rejects.toMatchObject({ status: 404 });
    expect(stripe.paymentIntents.capture).not.toHaveBeenCalled();
  });
  it("stale workers cannot advance a reclaimed attempt", async () => {
    const oldToken=randomUUID(), newToken=randomUUID();
    const claim=await db.rpc("checkout_claim_finalization",{ p_attempt_id:attemptId,p_customer_id:customer,p_token:oldToken }); expect(claim.error).toBeNull();
    await update("payment_attempts",attemptId,{ processing_until:new Date(0).toISOString() });
    const reclaimed=await db.rpc("checkout_claim_finalization",{ p_attempt_id:attemptId,p_customer_id:customer,p_token:newToken }); expect(reclaimed.error).toBeNull();
    const stale=await db.rpc("checkout_advance_finalization",{ p_attempt_id:attemptId,p_token:oldToken,p_step:"CAPTURE_PENDING" });
    expect(stale.error?.code).toBe("P0020");
  });
  it.each([1999,2000,19999,20000])("accepts the %i hundredths-of-a-pound boundary in the order transaction", async (weight) => {
    await cleanupPayments();
    await update("products",product,{ unit_weight:weight,price_cents:500 });
    const changed=await db.from("cart_items").update({ quantity:1 }).eq("cart_id",cart); if(changed.error) throw changed.error;
    const fee=weight>=2000?1000:0;
    const prepared=await createCustomerPaymentIntent(db,customer,"checkout-test",{ addressId:address,
      expected:{ ...expected,totalWeight:weight,deliveryFeeCents:fee,totalCents:525+fee } });
    attemptId=prepared.attemptId; providerId=prepared.paymentIntentId;
    const result=await confirm();
    expect((await rows("orders","id",result.orderId!))[0]).toMatchObject({ total_weight:weight,delivery_fee_cents:fee,total_cents:525+fee });
  });
  it("rejects weight above 200 lb during the locked recheck", async () => {
    stripe.paymentIntents.capture.mockImplementationOnce(async (id) => {
      await update("products",product,{ unit_weight:10001 });
      const intent=intents.get(id)!; Object.assign(intent,{ status:"succeeded",amount_received:1525 }); return { ...intent };
    });
    expect(await confirm()).toMatchObject({ status:"REFUNDED",failureCode:"CART_OVERWEIGHT" });
    expect(await rows("orders","customer_id",customer)).toHaveLength(0);
  });
  it("finds a successful refund after its response was lost", async () => {
    stripe.paymentIntents.capture.mockImplementationOnce(async (id) => {
      await update("products",product,{ stock_quantity:0 });
      const intent=intents.get(id)!; Object.assign(intent,{ status:"succeeded",amount_received:1525 }); return { ...intent };
    });
    stripe.refunds.create.mockImplementationOnce(async (params) => {
      refunds.push({ id:"re_recovered",amount:params.amount,currency:"usd",status:"succeeded",metadata:params.metadata });
      throw new Error("refund response lost");
    });
    await expect(confirm()).rejects.toThrow();
    expect(await confirm()).toMatchObject({ status:"REFUNDED" });
    expect(stripe.refunds.create).toHaveBeenCalledTimes(1);
  });
  it("two customers cannot buy the same last stock", async () => {
    const other=randomUUID(), otherCart=randomUUID(), otherAddress=randomUUID(); extraCustomers.push(other);
    await insert("users",{ id:other,email:`${other}@finalize.test`,password_hash:"test-only",role:"CUSTOMER" });
    await insert("carts",{ id:otherCart,customer_id:other });
    await insert("cart_items",{ cart_id:otherCart,product_id:product,quantity:2 });
    await insert("addresses",{ id:otherAddress,customer_id:other,line_1:"Test",city:"Test",state:"CA",postal_code:"00000",location:"SRID=4326;POINT(0 0)" });
    const second=await createCustomerPaymentIntent(db,other,"other-key",{ addressId:otherAddress,expected });
    // Both authorizations pass the pre-capture read before either transaction runs.
    let captured=0, release!:()=>void;
    const barrier=new Promise<void>((resolve)=>{ release=resolve; });
    stripe.paymentIntents.capture.mockImplementation(async(id)=>{
      const intent=intents.get(id)!; Object.assign(intent,{ status:"succeeded",amount_received:1525 });
      if(++captured===2) release(); await barrier; return { ...intent };
    });
    const results=await Promise.all([confirm(),confirmCustomerPayment(db,other,second.attemptId,"other-key")]);
    expect(results.map(r=>r.status).sort()).toEqual(["CAPTURED","REFUNDED"]);
    expect((await rows("products","id",product))[0].stock_quantity).toBe(0);
    expect(stripe.refunds.create).toHaveBeenCalledTimes(1);
  });
});
