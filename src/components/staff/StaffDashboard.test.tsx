import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AuditEntry } from "@/lib/audit/log";
import type { CatalogCategory } from "@/lib/catalog/types";
import { AuditEntryRow } from "./AuditLogPanel";
import { InventoryRow } from "./InventoryRow";
import { Notice } from "./Notice";
import { ProductForm } from "./ProductForm";
import { StaffDashboard } from "./StaffDashboard";
import type { InventoryItem } from "./staffApi";

// First-render markup (what the browser gets before hydration). Fetching and
// clicks happen in effects and handlers, which the helper modules' tests cover.

const CATEGORIES: CatalogCategory[] = [
  { id: "c1", name: "Dairy & Eggs", slug: "dairy-eggs" },
  { id: "c2", name: "Pantry", slug: "pantry" },
];

const ITEM: InventoryItem = {
  productId: "p1",
  sku: "MILK-1",
  name: "Whole Milk",
  categoryId: "c1",
  description: "One gallon",
  imageUrl: null,
  priceCents: 499,
  unitWeight: 860,
  stockQuantity: 40,
  updatedAt: "2026-10-28T12:00:00Z",
};

const noop = () => {};

function row(item: InventoryItem, canManage: boolean) {
  return renderToStaticMarkup(
    <InventoryRow
      item={item}
      categoryName="Dairy & Eggs"
      busy={false}
      canManage={canManage}
      onSaveQuantity={noop}
      onEdit={noop}
      onRetire={noop}
      onInvalid={noop}
    />,
  );
}

describe("StaffDashboard", () => {
  it("shows employees the inventory tabs but not the audit log or product tools", () => {
    const html = renderToStaticMarkup(
      <StaffDashboard role="EMPLOYEE" email="employee.test@ofs.local" categories={CATEGORIES} />,
    );
    expect(html).toContain("Employee");
    expect(html).toContain("employee.test@ofs.local");
    expect(html).toContain(">Inventory<");
    expect(html).toContain(">Low stock<");
    expect(html).not.toContain("Audit log");
    expect(html).not.toContain("New product");
  });

  it("gives managers the audit log tab and the new product button", () => {
    const html = renderToStaticMarkup(
      <StaffDashboard role="MANAGER" email="manager.test@ofs.local" categories={CATEGORIES} />,
    );
    expect(html).toContain("Manager");
    expect(html).toContain("Audit log");
    expect(html).toContain("New product");
    expect(html).toContain("Loading inventory...");
  });
});

describe("InventoryRow", () => {
  it("shows the product and its editable stock", () => {
    const html = row(ITEM, false);
    expect(html).toContain("Whole Milk");
    expect(html).toContain("MILK-1 · Dairy &amp; Eggs · $4.99 · 8.60 lb");
    expect(html).toContain('value="40"');
    expect(html).toContain('aria-label="Save stock for Whole Milk"');
    expect(html).not.toContain("Low stock");
  });

  it("hides edit and retire from employees", () => {
    expect(row(ITEM, false)).not.toContain("Retire");
    const html = row(ITEM, true);
    expect(html).toContain("Edit");
    expect(html).toContain("Retire");
  });

  it.each([
    [10, "Low stock"],
    [0, "Out of stock"],
  ])("flags stock of %i as %s", (stockQuantity, label) => {
    expect(row({ ...ITEM, stockQuantity }, false)).toContain(label);
  });

  it("does not flag stock just above the threshold", () => {
    expect(row({ ...ITEM, stockQuantity: 11 }, false)).not.toContain("stock</span>");
  });
});

describe("ProductForm", () => {
  const render = (editing: InventoryItem | null) =>
    renderToStaticMarkup(
      <ProductForm categories={CATEGORIES} editing={editing} onSubmit={async () => null} onCancel={noop} />,
    );

  it("asks for starting stock when creating a product", () => {
    const html = render(null);
    expect(html).toContain("New product");
    expect(html).toContain("Starting stock");
    expect(html).toContain("Create product");
    expect(html).toContain("Choose a category");
    expect(html).toContain("Pantry");
  });

  it("prefills an edit with decimal text and leaves stock to the inventory list", () => {
    const html = render(ITEM);
    expect(html).toContain("Edit Whole Milk");
    expect(html).toContain('value="4.99"');
    expect(html).toContain('value="8.60"');
    expect(html).toContain("Stock is 40. Change it from the inventory list.");
    expect(html).not.toContain("Starting stock");
    expect(html).toContain("Save changes");
  });

  it("keeps a product's category selectable when it is no longer active", () => {
    expect(render({ ...ITEM, categoryId: "c-old" })).toContain("(Inactive category)");
    expect(render(ITEM)).not.toContain("(Inactive category)");
  });
});

describe("AuditEntryRow", () => {
  const entry: AuditEntry = {
    id: "a1",
    action: "INVENTORY_SET_QUANTITY",
    productId: "p1",
    productSku: "MILK-1",
    productName: "Whole Milk",
    actorUserId: "u1",
    actorEmail: "employee.test@ofs.local",
    oldValue: { stock_quantity: 40 },
    newValue: { stock_quantity: 38 },
    createdAt: "2026-10-28T22:04:00Z",
  };

  it("shows who changed what and when", () => {
    const html = renderToStaticMarkup(<AuditEntryRow entry={entry} categoryNames={{}} />);
    expect(html).toContain("Stock set: Whole Milk");
    expect(html).toContain("Stock: 40 → 38");
    expect(html).toContain("by employee.test@ofs.local");
    expect(html).toContain('dateTime="2026-10-28T22:04:00Z"');
  });

  it("copes with a deleted actor or product", () => {
    const html = renderToStaticMarkup(
      <AuditEntryRow entry={{ ...entry, actorEmail: null, productName: null, productSku: null }} categoryNames={{}} />,
    );
    expect(html).toContain("Unknown product");
    expect(html).toContain("by unknown user");
  });
});

describe("Notice", () => {
  it("renders an error as an alert and a success as a status", () => {
    expect(renderToStaticMarkup(<Notice notice={{ kind: "error", text: "Nope" }} onDismiss={noop} />)).toContain(
      'role="alert"',
    );
    const html = renderToStaticMarkup(<Notice notice={{ kind: "success", text: "Saved" }} onDismiss={noop} />);
    expect(html).toContain('role="status"');
    expect(html).toContain("Saved");
  });
});
