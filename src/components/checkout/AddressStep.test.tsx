import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AddressStep } from "./AddressStep";
import type { SavedAddress } from "./checkoutApi";

const HOME: SavedAddress = {
  id: "a1", label: "Home", line1: "87 N San Pedro St", line2: null, city: "San Jose", state: "CA", postalCode: "95110", isDefault: true,
};
const WORK: SavedAddress = { ...HOME, id: "a2", label: null, line1: "211 S 1st St", line2: "Suite 2", postalCode: "95113", isDefault: false };

const render = (overrides: Partial<Parameters<typeof AddressStep>[0]> = {}) => renderToStaticMarkup(
  <AddressStep addresses={[HOME, WORK]} selectedId="a1" confirmedId={null} locked={false} busy={false}
    onSelect={vi.fn()} onAdded={vi.fn()} onConfirm={vi.fn()} onChange={vi.fn()} {...overrides} />,
);

describe("AddressStep", () => {
  it("lists saved addresses with the selected one checked and a confirm button", () => {
    const html = render();
    expect(html).toContain("87 N San Pedro St, San Jose, CA 95110");
    expect(html).toContain("211 S 1st St Suite 2, San Jose, CA 95113");
    expect(html).toMatch(/checked="" value="a1"/);
    expect(html).toContain("Deliver here");
    expect(html).toContain("Add a new address");
  });

  it("disables confirming with nothing selected or while busy", () => {
    expect(render({ selectedId: null })).toMatch(/disabled=""[^>]*>Deliver here/);
    expect(render({ busy: true })).toContain("Checking…");
    expect(render({ busy: true }).match(/type="radio"[^>]*disabled=""/g)).toHaveLength(2);
    expect(render({ busy: true })).toMatch(/<button[^>]*disabled=""[^>]*>[\s\S]*?Add a new address/);
  });

  it("opens the new-address form when there are no saved addresses", () => {
    const html = render({ addresses: [], selectedId: null });
    expect(html).toContain('aria-label="New address"');
    expect(html).toContain('name="postalCode"');
    expect(html).toContain('value="San Jose"');
    expect(html).not.toContain("Deliver here");
    // Nothing to go back to, so no cancel button.
    expect(html).not.toContain(">Cancel<");
  });

  it("shows the confirmed address with a change link", () => {
    const html = render({ confirmedId: "a1" });
    expect(html).toContain("Home");
    expect(html).toContain("87 N San Pedro St, San Jose, CA 95110");
    expect(html).toContain("Change address");
    expect(html).not.toContain("211 S 1st St");
  });

  it("warns that changing the address cancels a payment in progress", () => {
    expect(render({ confirmedId: "a1", locked: true })).toContain("Change address (cancels this payment)");
  });
});
