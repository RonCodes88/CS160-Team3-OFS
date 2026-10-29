import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { PaymentStep } from "./PaymentStep";

vi.mock("@stripe/stripe-js", () => ({ loadStripe: vi.fn(() => new Promise(() => {})) }));
vi.mock("@stripe/react-stripe-js", () => ({
  Elements: ({ children, options }: { children: React.ReactNode; options: { clientSecret: string } }) =>
    <div data-secret={options.clientSecret}>{children}</div>,
  PaymentElement: () => <div>card fields</div>,
  useStripe: () => ({}),
  useElements: () => ({}),
}));

const render = (finalizing = false) => renderToStaticMarkup(
  <PaymentStep publishableKey="pk_test_x" clientSecret="pi_1_secret_2" totalCents={3099}
    finalizing={finalizing} onCardError={vi.fn()} onAuthorized={vi.fn()} />,
);

describe("PaymentStep", () => {
  it("renders Stripe's payment fields for the intent with the server total on the button", () => {
    const html = render();
    expect(html).toContain('data-secret="pi_1_secret_2"');
    expect(html).toContain("card fields");
    expect(html).toContain("Pay $30.99");
    expect(html).toContain("4242 4242 4242 4242");
  });

  it("disables paying while the order is placed", () => {
    expect(render(true)).toMatch(/disabled=""[^>]*>Placing your order…/);
  });
});
