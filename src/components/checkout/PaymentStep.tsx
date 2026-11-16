"use client";

import { useState, type FormEvent } from "react";
import { loadStripe, type Stripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { formatCents } from "@/lib/cart/format";

// Load Stripe.js once per page, and only when a payment form is shown.
let stripePromise: Promise<Stripe | null> | null = null;
function getStripe(publishableKey: string) {
  stripePromise ??= loadStripe(publishableKey);
  return stripePromise;
}

type Props = {
  publishableKey: string;
  clientSecret: string;
  totalCents: number;
  /** Disables the form while the server finalizes the order. */
  finalizing: boolean;
  /** Stripe reported a decline or other card error; shown under the form. */
  onCardError(message: string): void;
  /** The card was authorized; the server can now capture it and create the order. */
  onAuthorized(): void;
};

/**
 * Card details go straight from Stripe's iframe to Stripe. OFS only ever sees
 * the payment intent's ID and status, never card numbers, CVC or expiry.
 */
export function PaymentStep({ publishableKey, clientSecret, ...props }: Props) {
  return (
    <Card>
      <h2 className="text-3xl">3. Payment</h2>
      <p className="mt-2 flex items-center gap-2 text-base text-pencil/70">
        <Lock aria-hidden strokeWidth={2.5} className="h-4 w-4" /> Test mode: use card 4242 4242 4242 4242.
      </p>
      <Elements key={clientSecret} stripe={getStripe(publishableKey)} options={{ clientSecret, appearance: { theme: "flat" } }}>
        <PaymentForm {...props} />
      </Elements>
    </Card>
  );
}

function PaymentForm({ totalCents, finalizing, onCardError, onAuthorized }: Omit<Props, "publishableKey" | "clientSecret">) {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!stripe || !elements) return;
    setSubmitting(true);
    try {
      // Cards authenticate in a Stripe dialog, so no redirect happens; the
      // return URL only matters for redirect-based methods, which are disabled.
      const { error } = await stripe.confirmPayment({
        elements,
        redirect: "if_required",
        confirmParams: { return_url: `${window.location.origin}/checkout` },
      });
      if (error) onCardError(error.message ?? "Your payment didn't go through. Try again.");
      else onAuthorized();
    } catch {
      onCardError("We couldn't confirm your payment. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const busy = submitting || finalizing;
  return (
    <form className="mt-6" onSubmit={onSubmit}>
      <PaymentElement />
      <Button type="submit" className="mt-6 w-full" disabled={!stripe || !elements || busy}>
        {finalizing ? "Placing your order…" : submitting ? "Processing…" : `Pay ${formatCents(totalCents)}`}
      </Button>
    </form>
  );
}
