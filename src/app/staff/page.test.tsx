import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getCurrentUser } from "@/lib/auth/currentUser";
import type { Role } from "@/lib/auth/session";
import { getCatalogCategories } from "@/lib/catalog/service";
import Page from "./page";

vi.mock("@/lib/auth/currentUser", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/catalog/service", () => ({ getCatalogCategories: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`redirect:${url}`);
  }),
}));

function signInAs(role: Role) {
  vi.mocked(getCurrentUser).mockResolvedValue({ id: "u1", email: `${role.toLowerCase()}@ofs.local`, role });
}

const render = async () => renderToStaticMarkup(await Page());

beforeEach(() => {
  vi.mocked(getCatalogCategories).mockResolvedValue([{ id: "c1", name: "Pantry", slug: "pantry" }]);
});

describe("/staff page", () => {
  it("sends signed-out visitors to log in and come back", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null);
    await expect(render()).rejects.toThrow("redirect:/login?next=/staff");
  });

  it.each<Role>(["CUSTOMER", "VEHICLE"])("shows %s accounts a staff-only message", async (role) => {
    signInAs(role);
    const html = await render();
    expect(html).toContain("Staff only");
    expect(html).not.toContain("Staff dashboard");
    expect(getCatalogCategories).not.toHaveBeenCalled();
  });

  it("shows employees the dashboard without manager tools", async () => {
    signInAs("EMPLOYEE");
    const html = await render();
    expect(html).toContain("Staff dashboard");
    expect(html).not.toContain("Audit log");
  });

  it("shows managers the dashboard with manager tools", async () => {
    signInAs("MANAGER");
    const html = await render();
    expect(html).toContain("Staff dashboard");
    expect(html).toContain("Audit log");
  });

  it("still renders when categories fail to load", async () => {
    signInAs("MANAGER");
    vi.mocked(getCatalogCategories).mockRejectedValue(new Error("db down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await render()).toContain("Staff dashboard");
  });
});
