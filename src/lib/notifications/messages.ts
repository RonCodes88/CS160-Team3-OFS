import { formatCents } from "@/lib/cart/format";

// Builds the customer-facing text for each notification. Pure functions: all
// data comes from the order's checkout snapshot and the event payload saved
// when the notification was queued.

export type NotificationType = "ORDER_CONFIRMED" | "READY_FOR_DELIVERY" | "DELIVERY_UPDATE" | "DELIVERED";

export type OrderSummary = {
  id: string;
  subtotalCents: number;
  deliveryFeeCents: number;
  taxCents: number;
  totalCents: number;
  deliveryAddress: Record<string, unknown>;
  items: { productName: string; quantity: number; unitPriceCents: number }[];
};

export type RenderedMessage = { subject: string; text: string };

/** The store is in Downtown San Jose, so times are shown in Pacific time. */
const STORE_TIME_ZONE = "America/Los_Angeles";

const timeFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: STORE_TIME_ZONE,
  hour: "numeric",
  minute: "2-digit",
});

/** Short, readable order number: "#" plus the first 8 hex digits of the ID. */
export function orderNumber(orderId: string): string {
  return `#${orderId.replace(/-/g, "").slice(0, 8).toUpperCase()}`;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** Formats the checkout address snapshot (line_1, line_2, city, state, postal_code). */
export function formatAddress(address: Record<string, unknown>): string {
  const cityLine = [text(address.city), [text(address.state), text(address.postal_code)].filter(Boolean).join(" ")]
    .filter(Boolean)
    .join(", ");
  return [text(address.line_1), text(address.line_2), cityLine].filter(Boolean).join("\n");
}

/** "12:40 PM" in store time, or null for a missing or invalid timestamp. */
export function formatTime(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : timeFormat.format(date);
}

function confirmation(order: OrderSummary): RenderedMessage {
  const number = orderNumber(order.id);
  const lines = order.items.map(
    (item) => `  ${item.quantity} × ${item.productName}  ${formatCents(item.quantity * item.unitPriceCents)}`,
  );
  const totals = [
    `Subtotal: ${formatCents(order.subtotalCents)}`,
    `Delivery: ${order.deliveryFeeCents === 0 ? "Free" : formatCents(order.deliveryFeeCents)}`,
    ...(order.taxCents > 0 ? [`Tax: ${formatCents(order.taxCents)}`] : []),
    `Total charged: ${formatCents(order.totalCents)}`,
  ];
  return {
    subject: `Order ${number} confirmed`,
    text: [
      "Thanks for your order! Here's your receipt.",
      "",
      `Order ${number}`,
      ...lines,
      "",
      ...totals,
      "",
      "Delivering to:",
      formatAddress(order.deliveryAddress),
      "",
      "We'll let you know when your robot is on the way.",
    ].join("\n"),
  };
}

function deliveryUpdate(number: string, payload: Record<string, unknown>): RenderedMessage {
  const eta = formatTime(payload.estimated_arrival);
  switch (payload.reason) {
    case "ETA_CHANGED": {
      const before = formatTime(payload.previous_estimated_arrival);
      return {
        subject: `New arrival time for order ${number}`,
        text: `Your robot now expects to arrive around ${eta ?? "soon"}${before ? ` (it was ${before})` : ""}.`,
      };
    }
    case "DELAYED":
      return {
        subject: `Order ${number} is running late`,
        text: `Sorry, your robot is running behind.${eta ? ` New estimated arrival: ${eta}.` : ""} You don't need to do anything.`,
      };
    case "ARRIVED":
      return {
        subject: `Your robot has arrived with order ${number}`,
        text: "Your robot is at your delivery address. Please meet it to collect your groceries.",
      };
    case "FAILED":
      return {
        subject: `We couldn't deliver order ${number}`,
        text: "Your robot couldn't complete this delivery. Our team will follow up with you.",
      };
    default:
      return { subject: `Update on order ${number}`, text: "There's an update on your delivery." };
  }
}

/** Subject and body for one queued notification. */
export function renderMessage(
  type: NotificationType,
  payload: Record<string, unknown>,
  order: OrderSummary,
): RenderedMessage {
  const number = orderNumber(order.id);
  switch (type) {
    case "ORDER_CONFIRMED":
      return confirmation(order);
    case "READY_FOR_DELIVERY":
      return {
        subject: `Order ${number} is on its way`,
        text: `Your robot has left the store with order ${number}. We'll message you if anything changes.`,
      };
    case "DELIVERY_UPDATE":
      return deliveryUpdate(number, payload);
    case "DELIVERED":
      return {
        subject: `Order ${number} delivered`,
        text: `Order ${number} has been delivered. Enjoy your groceries!`,
      };
  }
}
