import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getCurrentUser } from "@/lib/auth/currentUser";
import type { Role } from "@/lib/auth/session";
import { listCustomerOrders } from "@/lib/orders/read";
import Page from "./page";

vi.mock("@/lib/auth/currentUser", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/orders/read", () => ({ listCustomerOrders: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`redirect:${url}`);
  }),
}));

const signInAs = (role: Role) =>
  vi.mocked(getCurrentUser).mockResolvedValue({ id: "u1", email: `${role.toLowerCase()}@ofs.local`, role });

const render = async () => renderToStaticMarkup(await Page());

beforeEach(() => {
  vi.mocked(listCustomerOrders).mockReset();
});

describe("/track", () => {
  it("sends signed-out visitors to log in and come back", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null);
    await expect(render()).rejects.toThrow("redirect:/login?next=/track");
  });

  it.each<[Role, string]>([
    ["EMPLOYEE", "/staff"],
    ["MANAGER", "/staff"],
    ["VEHICLE", "/"],
  ])("sends %s accounts to their own home", async (role, home) => {
    signInAs(role);
    await expect(render()).rejects.toThrow(`redirect:${home}`);
    expect(listCustomerOrders).not.toHaveBeenCalled();
  });

  it("lists the customer's own orders with links to track each one", async () => {
    signInAs("CUSTOMER");
    vi.mocked(listCustomerOrders).mockResolvedValue([
      { id: "aad98780-7a58-48eb-896d-7c23f0e285e9", status: "OUT_FOR_DELIVERY", totalCents: 524, paidAt: "2026-11-16T01:00:00Z", itemCount: 1 },
      { id: "5dadc429-4d1a-4700-b71e-e128c61b368b", status: "DELIVERED", totalCents: 1469, paidAt: null, itemCount: 3 },
    ]);
    const html = await render();
    expect(listCustomerOrders).toHaveBeenCalledWith({}, "u1");
    expect(html).toContain('href="/track/aad98780-7a58-48eb-896d-7c23f0e285e9"');
    expect(html).toContain("Order #AAD98780");
    expect(html).toContain("Nov 15, 2026, 5:00 PM · 1 item · $5.24");
    expect(html).toContain("Out for delivery →");
    expect(html).toContain("3 items · $14.69");
    expect(html).toContain("Delivered →");
  });

  it("points a customer with no orders to the shop", async () => {
    signInAs("CUSTOMER");
    vi.mocked(listCustomerOrders).mockResolvedValue([]);
    const html = await render();
    expect(html).toContain("You haven&#x27;t placed an order yet.");
    expect(html).toContain('href="/shop"');
  });
});
