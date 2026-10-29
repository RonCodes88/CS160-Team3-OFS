import { beforeEach, describe, expect, it, vi } from "vitest";
import Page from "./page";
import { listAddresses } from "@/lib/auth/addresses";
import { getCurrentUser } from "@/lib/auth/currentUser";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/auth/currentUser", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/auth/addresses", () => ({ listAddresses: vi.fn() }));
vi.mock("@/components/checkout/CheckoutView", () => ({ CheckoutView: () => null }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`REDIRECT ${to}`); } }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", "pk_test_x");
  vi.mocked(listAddresses).mockResolvedValue([]);
});

describe("checkout page", () => {
  it("passes the customer's saved addresses and the publishable key to the checkout", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({ id: "customer", email: "c@example.test", role: "CUSTOMER" });
    const element = await Page();
    expect(listAddresses).toHaveBeenCalledWith({}, "customer");
    expect(element.props).toEqual({ initialAddresses: [], publishableKey: "pk_test_x" });
  });

  it("sends signed-out visitors to log in and other roles home", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null);
    await expect(Page()).rejects.toThrow("REDIRECT /login?next=/checkout");
    vi.mocked(getCurrentUser).mockResolvedValue({ id: "m", email: "m@example.test", role: "MANAGER" });
    await expect(Page()).rejects.toThrow("REDIRECT /staff");
    expect(listAddresses).not.toHaveBeenCalled();
  });
});
