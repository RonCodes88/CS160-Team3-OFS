import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Page from "./page";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { getCustomerOrder } from "@/lib/orders/read";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/auth/currentUser", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/orders/read", () => ({ getCustomerOrder: vi.fn() }));
vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("NOT_FOUND"); },
  redirect: (to: string) => { throw new Error(`REDIRECT ${to}`); },
}));

const ID = "00000000-0000-4000-8000-0000000000AB";
const ORDER = {
  id: ID.toLowerCase(), status: "PAID", subtotalCents: 898, deliveryFeeCents: 1000, taxCents: 45, totalCents: 1943,
  totalWeight: 2020, paidAt: "2026-10-29T00:00:00Z",
  deliveryAddress: { line_1: "87 N San Pedro St", line_2: null, city: "San Jose", state: "CA", postal_code: "95110" },
  items: [{ productName: "Whole Milk", quantity: 2, unitPriceCents: 449 }],
};
const render = async (orderId = ID) =>
  renderToStaticMarkup(await Page({ params: Promise.resolve({ orderId }) } as PageProps<"/orders/[orderId]">));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getCurrentUser).mockResolvedValue({ id: "customer", email: "c@example.test", role: "CUSTOMER" });
  vi.mocked(getCustomerOrder).mockResolvedValue(ORDER);
});

describe("order confirmation page", () => {
  it("shows the customer's order snapshot", async () => {
    const html = await render();
    expect(getCustomerOrder).toHaveBeenCalledWith({}, "customer", ID.toLowerCase());
    expect(html).toContain("Your order is confirmed");
    expect(html).toContain("87 N San Pedro St, San Jose, CA 95110");
    expect(html).toContain("Paid, waiting for a robot");
    expect(html).toContain("Whole Milk");
    expect(html).toContain("$8.98");
    expect(html).toContain("$10.00");
    expect(html).toContain("$0.45");
    expect(html).toContain("$19.43");
    expect(html).toContain("20.20 lb");
  });

  it("shows Free delivery and an unknown status as-is", async () => {
    vi.mocked(getCustomerOrder).mockResolvedValue({ ...ORDER, deliveryFeeCents: 0, status: "NEW_STATUS" });
    const html = await render();
    expect(html).toContain("Free");
    expect(html).toContain("NEW_STATUS");
  });

  it("returns 404 for another customer's order or a bad ID", async () => {
    vi.mocked(getCustomerOrder).mockResolvedValue(null);
    await expect(render()).rejects.toThrow("NOT_FOUND");
    await expect(render("not-a-uuid")).rejects.toThrow("NOT_FOUND");
  });

  it("sends signed-out visitors to log in and staff home", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null);
    await expect(render()).rejects.toThrow(`REDIRECT /login?next=/orders/${ID}`);
    vi.mocked(getCurrentUser).mockResolvedValue({ id: "s", email: "s@example.test", role: "EMPLOYEE" });
    await expect(render()).rejects.toThrow("REDIRECT /staff");
    expect(getCustomerOrder).not.toHaveBeenCalled();
  });
});
