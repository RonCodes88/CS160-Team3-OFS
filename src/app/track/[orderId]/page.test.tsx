import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getCurrentUser } from "@/lib/auth/currentUser";
import type { Role } from "@/lib/auth/session";
import { getCustomerTracking } from "@/lib/orders/tracking";
import Page from "./page";

vi.mock("@/lib/auth/currentUser", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/orders/tracking", () => ({ getCustomerTracking: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`redirect:${url}`);
  }),
  notFound: vi.fn(() => {
    throw new Error("notFound");
  }),
}));

const ORDER = "AAD98780-7A58-48EB-896D-7C23F0E285E9";
const signInAs = (role: Role) =>
  vi.mocked(getCurrentUser).mockResolvedValue({ id: "u1", email: `${role.toLowerCase()}@ofs.local`, role });
const render = async (orderId = ORDER) =>
  renderToStaticMarkup(await Page({ params: Promise.resolve({ orderId }) } as PageProps<"/track/[orderId]">));

beforeEach(() => {
  vi.mocked(getCustomerTracking).mockReset();
});

describe("/track/[orderId]", () => {
  it("sends signed-out visitors to log in and come back to this order", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null);
    await expect(render()).rejects.toThrow(`redirect:/login?next=/track/${ORDER}`);
  });

  it("sends staff to their own home", async () => {
    signInAs("EMPLOYEE");
    await expect(render()).rejects.toThrow("redirect:/staff");
    expect(getCustomerTracking).not.toHaveBeenCalled();
  });

  it("treats a malformed order ID as not found", async () => {
    signInAs("CUSTOMER");
    await expect(render("not-an-id")).rejects.toThrow("notFound");
    expect(getCustomerTracking).not.toHaveBeenCalled();
  });

  it.each(["FORBIDDEN", "NOT_FOUND"] as const)("hides the order when tracking says %s", async (reason) => {
    signInAs("CUSTOMER");
    vi.mocked(getCustomerTracking).mockResolvedValue({ ok: false, reason });
    await expect(render()).rejects.toThrow("notFound");
  });

  it("shows the signed-in customer's own order", async () => {
    signInAs("CUSTOMER");
    vi.mocked(getCustomerTracking).mockResolvedValue({
      ok: true,
      tracking: {
        orderId: ORDER.toLowerCase(),
        status: "PAID",
        tripStatus: null,
        stopStatus: null,
        estimatedArrival: null,
        route: null,
        robotLocation: null,
        destination: null,
      },
    });
    const html = await render();
    expect(getCustomerTracking).toHaveBeenCalledWith({}, "u1", ORDER.toLowerCase());
    expect(html).toContain("Order #AAD98780");
    expect(html).toContain("We&#x27;re getting your order ready.");
  });
});
