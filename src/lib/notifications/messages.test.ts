import { describe, expect, it } from "vitest";
import {
  formatAddress,
  formatTime,
  orderNumber,
  renderMessage,
  type OrderSummary,
} from "@/lib/notifications/messages";

const ORDER: OrderSummary = {
  id: "3f1c2b8e-9a4d-4e2f-8b1a-0c9d7e6f5a41",
  subtotalCents: 1894,
  deliveryFeeCents: 1000,
  taxCents: 0,
  totalCents: 2894,
  deliveryAddress: {
    line_1: "211 S 1st St",
    line_2: "Apt 4B",
    city: "San Jose",
    state: "CA",
    postal_code: "95113",
  },
  items: [
    { productName: "Whole Milk", quantity: 2, unitPriceCents: 449 },
    { productName: "Gala Apples", quantity: 3, unitPriceCents: 199 },
  ],
};

describe("orderNumber", () => {
  it("is # plus the first 8 hex digits, uppercased", () => {
    expect(orderNumber(ORDER.id)).toBe("#3F1C2B8E");
  });
});

describe("formatAddress", () => {
  it("formats the checkout snapshot on separate lines", () => {
    expect(formatAddress(ORDER.deliveryAddress)).toBe("211 S 1st St\nApt 4B\nSan Jose, CA 95113");
  });

  it("skips missing or blank parts", () => {
    expect(formatAddress({ line_1: "1 Main St", line_2: " ", city: "San Jose", state: "CA" })).toBe(
      "1 Main St\nSan Jose, CA",
    );
    expect(formatAddress({})).toBe("");
  });
});

describe("formatTime", () => {
  it("shows Pacific time, where the store is", () => {
    expect(formatTime("2026-10-20T19:40:00Z")).toBe("12:40 PM");
  });

  it.each([null, undefined, 42, "not a date"])("returns null for %j", (value) => {
    expect(formatTime(value)).toBeNull();
  });
});

describe("order confirmation (#35)", () => {
  const { subject, text } = renderMessage("ORDER_CONFIRMED", {}, ORDER);

  it("names the order in the subject", () => {
    expect(subject).toBe("Order #3F1C2B8E confirmed");
  });

  it("includes the order number, each item with its line total, the total, and the address", () => {
    expect(text).toContain("Order #3F1C2B8E");
    expect(text).toContain("2 × Whole Milk  $8.98");
    expect(text).toContain("3 × Gala Apples  $5.97");
    expect(text).toContain("Total charged: $28.94");
    expect(text).toContain("211 S 1st St\nApt 4B\nSan Jose, CA 95113");
  });

  it("shows the delivery fee, or Free under 20 lbs", () => {
    expect(text).toContain("Delivery: $10.00");
    const free = renderMessage("ORDER_CONFIRMED", {}, { ...ORDER, deliveryFeeCents: 0, totalCents: 1894 });
    expect(free.text).toContain("Delivery: Free");
  });

  it("only shows a tax line when there is tax", () => {
    expect(text).not.toContain("Tax:");
    const taxed = renderMessage("ORDER_CONFIRMED", {}, { ...ORDER, taxCents: 150, totalCents: 3044 });
    expect(taxed.text).toContain("Tax: $1.50");
  });
});

describe("delivery notifications (#36)", () => {
  it("tells the customer the order is on its way when the trip is dispatched", () => {
    expect(renderMessage("READY_FOR_DELIVERY", {}, ORDER).subject).toBe("Order #3F1C2B8E is on its way");
  });

  it("gives the new and old arrival times when the ETA changes", () => {
    const message = renderMessage(
      "DELIVERY_UPDATE",
      {
        reason: "ETA_CHANGED",
        estimated_arrival: "2026-10-20T19:55:00Z",
        previous_estimated_arrival: "2026-10-20T19:40:00Z",
      },
      ORDER,
    );
    expect(message.subject).toBe("New arrival time for order #3F1C2B8E");
    expect(message.text).toBe("Your robot now expects to arrive around 12:55 PM (it was 12:40 PM).");
  });

  it("apologizes for a delay and gives the new estimate when known", () => {
    const withEta = renderMessage(
      "DELIVERY_UPDATE",
      { reason: "DELAYED", estimated_arrival: "2026-10-20T20:05:00Z" },
      ORDER,
    );
    expect(withEta.subject).toBe("Order #3F1C2B8E is running late");
    expect(withEta.text).toContain("New estimated arrival: 1:05 PM.");
    expect(renderMessage("DELIVERY_UPDATE", { reason: "DELAYED" }, ORDER).text).not.toContain("estimated");
  });

  it.each([
    ["ARRIVED", "Your robot has arrived with order #3F1C2B8E"],
    ["FAILED", "We couldn't deliver order #3F1C2B8E"],
    ["SOMETHING_NEW", "Update on order #3F1C2B8E"],
  ])("has a message for %s", (reason, subject) => {
    expect(renderMessage("DELIVERY_UPDATE", { reason }, ORDER).subject).toBe(subject);
  });

  it("confirms delivery", () => {
    expect(renderMessage("DELIVERED", {}, ORDER)).toEqual({
      subject: "Order #3F1C2B8E delivered",
      text: "Order #3F1C2B8E has been delivered. Enjoy your groceries!",
    });
  });
});
