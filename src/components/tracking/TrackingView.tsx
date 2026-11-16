"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { AlertTriangle, Check, Clock, MapPinned } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { StickyTag } from "@/components/ui/StickyTag";
import { orderNumber } from "@/lib/notifications/messages";
import type { CustomerTracking } from "@/lib/orders/tracking";
import { fetchTracking } from "./trackingApi";
import {
  etaText,
  headline,
  isFinished,
  POLL_MS,
  routeCoordinates,
  STATUS_STEPS,
  stepIndex,
  toLngLat,
  updatedAgo,
  type LngLat,
} from "./trackingStatus";

// Mapbox needs the browser, so the map only loads on the client.
const TrackingMap = dynamic(() => import("./TrackingMap").then((m) => m.TrackingMap), {
  ssr: false,
  loading: () => <p className="p-6 text-center text-lg">Loading the map...</p>,
});

type Props = {
  initial: CustomerTracking;
  store: LngLat;
  /** When the server built the page, so the first render matches on both sides. */
  renderedAt: string;
};

/** Live view of one order. Refreshes every POLL_MS until it is delivered or canceled. */
export function TrackingView({ initial, store, renderedAt }: Props) {
  const [tracking, setTracking] = useState(initial);
  const [now, setNow] = useState(() => new Date(renderedAt));
  const [problem, setProblem] = useState<string | null>(null);
  const finished = isFinished(tracking.status);

  useEffect(() => {
    if (finished) return;
    const timer = setInterval(async () => {
      const result = await fetchTracking(initial.orderId);
      setNow(new Date());
      if (result.ok) {
        setTracking(result.tracking);
        setProblem(null);
      } else {
        setProblem(result.message);
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [initial.orderId, finished]);

  const route = routeCoordinates(tracking.route);
  const robot = tracking.status === "OUT_FOR_DELIVERY" ? toLngLat(tracking.robotLocation) : null;
  const eta = etaText(tracking, now);
  const current = stepIndex(tracking.status);

  return (
    <section className="mx-auto w-full max-w-5xl px-4 py-12 sm:px-6 md:py-16">
      <StickyTag>Order {orderNumber(tracking.orderId)}</StickyTag>
      <h1 className="mt-4 text-4xl md:text-5xl">Track my order</h1>
      <p className="mt-2 text-xl" aria-live="polite">
        {headline(tracking)}
      </p>

      <div
        role="alert"
        className={
          problem
            ? "mt-6 flex items-start gap-3 rounded-wobbly-md border-[3px] border-marker bg-white p-4 text-lg shadow-hard-sm"
            : "sr-only"
        }
      >
        {problem && (
          <>
            <AlertTriangle aria-hidden strokeWidth={2.5} className="mt-1 h-6 w-6 shrink-0 text-marker" />
            <p>{problem}</p>
          </>
        )}
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="h-96 overflow-hidden rounded-wobbly-md border-2 border-pencil bg-white shadow-soft lg:h-auto lg:min-h-[32rem]">
          {route ? (
            <TrackingMap route={route} store={store} destination={toLngLat(tracking.destination)} robot={robot} />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
              <MapPinned aria-hidden strokeWidth={2.5} className="h-12 w-12" />
              <p className="text-xl">
                {tracking.status === "CANCELED"
                  ? "There's no delivery for this order."
                  : "The map appears once your order is on a robot's route."}
              </p>
            </div>
          )}
        </div>

        <div className="space-y-6">
          {eta && (
            <Card tone="postit">
              <p className="flex items-center gap-2 text-lg">
                <Clock aria-hidden strokeWidth={2.5} className="h-5 w-5" /> Estimated arrival
              </p>
              <p className="mt-1 font-heading text-3xl">{eta}</p>
            </Card>
          )}

          <Card>
            <h2 className="text-2xl">Order status</h2>
            {tracking.status === "CANCELED" ? (
              <p className="mt-3 text-lg">Canceled</p>
            ) : (
              <ol className="mt-3 space-y-2 text-lg">
                {STATUS_STEPS.map((step, index) => {
                  const done = index < current || tracking.status === "DELIVERED";
                  const active = index === current && !done;
                  return (
                    <li
                      key={step.status}
                      aria-current={active ? "step" : undefined}
                      className={`flex items-center gap-2 ${done || active ? "" : "text-pencil/40"}`}
                    >
                      <span
                        className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 border-pencil ${done ? "bg-pencil text-white" : active ? "bg-postit" : "bg-white"}`}
                      >
                        {done && <Check aria-hidden strokeWidth={3} className="h-4 w-4" />}
                      </span>
                      <span className={active ? "font-heading" : ""}>{step.label}</span>
                    </li>
                  );
                })}
              </ol>
            )}
          </Card>

          <p className="text-base text-pencil/70">
            {robot && tracking.robotLocation
              ? `Robot location updated ${updatedAgo(tracking.robotLocation.updatedAt, now)}. `
              : ""}
            {finished ? "This order is complete." : "This page refreshes automatically."}
          </p>

          <Button href="/track" variant="secondary" className="w-full">
            All my orders
          </Button>
        </div>
      </div>
    </section>
  );
}
