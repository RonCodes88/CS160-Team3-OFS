"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ShoppingBasket } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { StickyTag } from "@/components/ui/StickyTag";
import { mapCartItems, type ApiCartResponse, type CartItem } from "@/components/cart/cartApi";
import { AddressStep } from "./AddressStep";
import { OrderReview } from "./OrderReview";
import { PaymentStep } from "./PaymentStep";
import {
  cancelPayment,
  confirmPayment,
  fetchPreview,
  loadPaymentSession,
  newPaymentKey,
  rejectionMessage,
  startPayment,
  storePaymentSession,
  totalsOf,
  type CheckoutPreview,
  type PaymentSession,
  type SavedAddress,
} from "./checkoutApi";

/** How long to keep asking while Stripe or the webhook is still processing. */
const CONFIRM_ATTEMPTS = 20;
const CONFIRM_DELAY_MS = 1500;

type ActivePayment = { session: PaymentSession; attemptId: string; clientSecret: string };

const sameTotals = (a: PaymentSession["expected"], b: CheckoutPreview) =>
  JSON.stringify(a) === JSON.stringify(totalsOf(b));

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function CheckoutView({ initialAddresses, publishableKey }: {
  initialAddresses: SavedAddress[];
  publishableKey: string;
}) {
  const router = useRouter();
  const [addresses, setAddresses] = useState(initialAddresses);
  const [selectedId, setSelectedId] = useState<string | null>(initialAddresses[0]?.id ?? null);
  const [confirmedId, setConfirmedId] = useState<string | null>(null);
  const [items, setItems] = useState<CartItem[] | null>(null);
  const [preview, setPreview] = useState<CheckoutPreview | null>(null);
  const [payment, setPayment] = useState<ActivePayment | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The server allows one unfinished payment per cart; offer to cancel it.
  const [blockedByPayment, setBlockedByPayment] = useState(false);
  // Set when confirmation could not finish; the customer can ask again.
  const [confirmRetry, setConfirmRetry] = useState<{ attemptId: string; key: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const resumed = useRef(false);

  const loadCart = useCallback(async () => {
    const response = await fetch("/api/cart", { cache: "no-store" });
    if (!response.ok) throw new Error("We couldn't load your cart.");
    setItems(mapCartItems((await response.json()) as ApiCartResponse));
  }, []);

  const review = useCallback(async (addressId: string) => {
    const result = await fetchPreview(addressId);
    if (!result.ok) {
      setPreview(null);
      setConfirmedId(null);
      setError(result.error.message);
      return false;
    }
    setPreview(result.preview);
    setConfirmedId(addressId);
    return true;
  }, []);

  /** Starting over after the checkout changed: reprice with fresh cart data. */
  const restart = useCallback(async (message: string) => {
    storePaymentSession(null);
    setPayment(null);
    setConfirmRetry(null);
    setError(message);
    await loadCart().catch(() => {});
    if (confirmedId) {
      const result = await fetchPreview(confirmedId);
      if (result.ok) setPreview(result.preview);
      else {
        setPreview(null);
        setConfirmedId(null);
      }
    }
  }, [confirmedId, loadCart]);

  /** Captures the authorized card and creates the order, polling while it is still processing. */
  const finalize = useCallback(async (attemptId: string, key: string) => {
    setFinalizing(true);
    setConfirmRetry(null);
    setError(null);
    try {
      for (let attempt = 0; attempt < CONFIRM_ATTEMPTS; attempt++) {
        const outcome = await confirmPayment(attemptId, key);
        if (outcome.kind === "placed") {
          storePaymentSession(null);
          router.replace(`/orders/${outcome.orderId}`);
          return;
        }
        if (outcome.kind === "declined") return setError(outcome.message);
        if (outcome.kind === "rejected") return await restart(rejectionMessage(outcome));
        if (outcome.kind === "error") {
          setConfirmRetry({ attemptId, key });
          return setError(outcome.message);
        }
        await wait(CONFIRM_DELAY_MS);
      }
      setConfirmRetry({ attemptId, key });
      setError("Your payment is still processing. Check again in a moment.");
    } finally {
      setFinalizing(false);
    }
  }, [restart, router]);

  /** Cancels an unfinished payment, or finishes it if the customer already authorized it. */
  const abandonPayment = useCallback(async (session: PaymentSession | null, attemptId: string | null) => {
    const result = await cancelPayment();
    if (result.ok) {
      storePaymentSession(null);
      setPayment(null);
      setBlockedByPayment(false);
      return true;
    }
    if (result.error.code === "PAYMENT_ALREADY_AUTHORIZED" && session && attemptId) {
      await finalize(attemptId, session.key);
    } else {
      setError(result.error.message);
    }
    return false;
  }, [finalize]);

  const begin = useCallback(async (session: PaymentSession) => {
    storePaymentSession(session);
    const result = await startPayment(session);
    if (result.ok) {
      setBlockedByPayment(false);
      if (result.clientSecret) {
        setPayment({ session, attemptId: result.attemptId, clientSecret: result.clientSecret });
      } else {
        // Already authorized or finished, e.g. after a reload mid-confirmation.
        await finalize(result.attemptId, session.key);
      }
      return;
    }
    if (result.current) setPreview(result.current);
    if (result.error.code === "PAYMENT_IN_PROGRESS") {
      storePaymentSession(null);
      setBlockedByPayment(true);
    } else if (["TOTALS_MISMATCH", "CHECKOUT_CHANGED", "IDEMPOTENCY_CONFLICT"].includes(result.error.code)) {
      // The cart or address changed under a stored payment. Release it and start over.
      if (await abandonPayment(session, null)) {
        await restart("Your order changed. Review the updated summary and continue to payment.");
        return;
      }
    }
    setError(result.error.message);
  }, [abandonPayment, finalize, restart]);

  // Load the cart, then resume a payment left unfinished by a reload.
  useEffect(() => {
    if (resumed.current) return;
    resumed.current = true;
    void (async () => {
      try {
        await loadCart();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong.");
        return;
      }
      const stored = loadPaymentSession();
      if (!stored) return;
      if (!initialAddresses.some((a) => a.id === stored.addressId)) {
        storePaymentSession(null);
        return;
      }
      setBusy(true);
      setSelectedId(stored.addressId);
      try {
        if (await review(stored.addressId)) await begin(stored);
      } catch {
        setError("Network error. Check your connection and try again.");
      } finally {
        setBusy(false);
      }
    })();
  }, [begin, initialAddresses, loadCart, review]);

  async function run(task: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await task();
    } catch {
      setError("Network error. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  const onContinue = () => run(async () => {
    if (!preview || !confirmedId) return;
    // Reuse the stored key for the same review so a retry resumes, not duplicates.
    const stored = loadPaymentSession();
    const session = stored && stored.addressId === confirmedId && sameTotals(stored.expected, preview)
      ? stored
      : { key: newPaymentKey(), addressId: confirmedId, expected: totalsOf(preview) };
    await begin(session);
  });

  const onChangeAddress = () => run(async () => {
    if (payment && !(await abandonPayment(payment.session, payment.attemptId))) return;
    setConfirmedId(null);
    setPreview(null);
  });

  if (items === null && !error) {
    return (
      <section className="mx-auto w-full max-w-5xl px-4 py-12 text-center sm:px-6 md:py-16">
        <p className="animate-pulse text-2xl font-heading">Loading checkout...</p>
      </section>
    );
  }

  const emptyCart = items !== null && items.length === 0 && !payment && !finalizing;

  return (
    <section className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-6 md:py-16">
      <StickyTag>Checkout</StickyTag>
      <h1 className="mt-4 text-4xl md:text-5xl">Checkout</h1>

      <div role="alert" aria-live="assertive"
        className={error ? "mt-6 flex items-start gap-3 rounded-wobbly-md border-[3px] border-marker bg-white p-4 text-lg shadow-hard-sm" : "sr-only"}>
        {error && (
          <>
            <AlertTriangle aria-hidden strokeWidth={2.5} className="mt-1 h-6 w-6 shrink-0 text-marker" />
            <p className="flex-1">{error}</p>
            <button type="button" onClick={() => setError(null)} className="underline decoration-marker">Dismiss</button>
          </>
        )}
      </div>

      {emptyCart ? (
        <Card className="mt-8 text-center">
          <ShoppingBasket aria-hidden strokeWidth={2.5} className="mx-auto h-12 w-12" />
          <p className="mt-4 text-2xl">Your cart is empty.</p>
          <Button href="/shop" className="mt-6">Keep shopping</Button>
        </Card>
      ) : (
        <div className="mt-8 space-y-8">
          <AddressStep
            addresses={addresses}
            selectedId={selectedId}
            confirmedId={confirmedId}
            locked={payment !== null}
            busy={busy || finalizing}
            onSelect={setSelectedId}
            onAdded={(address) => {
              setAddresses((list) => [address, ...list.filter((a) => a.id !== address.id)]);
              setSelectedId(address.id);
            }}
            onConfirm={() => run(async () => { if (selectedId) await review(selectedId); })}
            onChange={onChangeAddress}
          />

          {preview && items && <OrderReview items={items} preview={preview} />}

          {preview && !payment && (
            <div className="space-y-3">
              {blockedByPayment && (
                <Card tone="postit">
                  <p className="text-lg">
                    A payment for this cart was started earlier and never finished. Cancel it to pay with this order.
                  </p>
                  <Button className="mt-4" variant="secondary" disabled={busy}
                    onClick={() => run(async () => { await abandonPayment(null, null); })}>
                    Cancel the earlier payment
                  </Button>
                </Card>
              )}
              <Button className="w-full" disabled={busy || finalizing || blockedByPayment} onClick={onContinue}>
                {busy ? "Preparing payment…" : "Continue to payment"}
              </Button>
              <p className="text-center text-base text-pencil/70">You won&apos;t be charged until you pay on the next step.</p>
            </div>
          )}

          {payment && preview && (
            <PaymentStep
              publishableKey={publishableKey}
              clientSecret={payment.clientSecret}
              totalCents={payment.session.expected.totalCents}
              finalizing={finalizing}
              onCardError={setError}
              onAuthorized={() => void finalize(payment.attemptId, payment.session.key)}
            />
          )}

          {confirmRetry && (
            <Button className="w-full" variant="secondary" disabled={finalizing}
              onClick={() => void finalize(confirmRetry.attemptId, confirmRetry.key)}>
              Check payment status again
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
