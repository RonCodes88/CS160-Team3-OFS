import { Truck } from "lucide-react";
import { formatWeight } from "@/lib/cart/format";
import { FREE_DELIVERY_WEIGHT_LIMIT } from "@/lib/cart/pricing";

export function WeightMeter({
  totalWeight,
}: {
  totalWeight: number;
}) {
  const free =
    totalWeight < FREE_DELIVERY_WEIGHT_LIMIT;

  const percent = Math.min(
    100,
    Math.round(
      (totalWeight * 100) / FREE_DELIVERY_WEIGHT_LIMIT,
    ),
  );

  return (
    <div className="mt-4">
      <div className="flex items-center justify-between text-base">
        <span className="inline-flex items-center gap-1">
          <Truck
            aria-hidden
            strokeWidth={2.5}
            className="h-4 w-4"
          />
          {free
            ? "Free delivery meter"
            : "Delivery fee applies"}
        </span>

        <span className="tabular-nums">
          {formatWeight(totalWeight)} /{" "}
          {formatWeight(FREE_DELIVERY_WEIGHT_LIMIT)}
        </span>
      </div>

      <div
        role="meter"
        aria-label="Cart weight toward the free delivery limit"
        aria-valuemin={0}
        aria-valuemax={FREE_DELIVERY_WEIGHT_LIMIT}
        aria-valuenow={Math.min(
          totalWeight,
          FREE_DELIVERY_WEIGHT_LIMIT,
        )}
        aria-valuetext={formatWeight(totalWeight)}
        className="mt-2 h-4 overflow-hidden rounded-wobbly border-2 border-pencil bg-white"
      >
        <div
          className={`h-full transition-[width] duration-200 ${free
            ? percent >= 90
              ? "bg-postit"
              : "bg-pen/60"
            : "bg-marker"
            }`}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
