import { Minus, Plus, Trash2 } from "lucide-react";
import { formatCents, formatWeight } from "@/lib/cart/format";
import type { CartItem } from "./cartApi";

const stepButton =
  "inline-flex h-10 w-10 items-center justify-center rounded-wobbly border-2 border-pencil bg-white shadow-hard-sm transition-all duration-100 hover:bg-postit active:translate-x-[2px] active:translate-y-[2px] active:shadow-none disabled:pointer-events-none disabled:opacity-40";

/** One cart line with a − quantity + stepper and a remove button. */
export function CartItemRow({
  item,
  isBusy,
  onChange,
}: {
  item: CartItem;
  isBusy: boolean;
  onChange: (productId: string, quantity: number) => void;
}) {
  return (
    <li
      className={`flex flex-wrap items-center gap-4 rounded-wobbly-md border-2 border-pencil bg-white p-4 shadow-soft transition-opacity ${isBusy
        ? "pointer-events-none opacity-50"
        : ""
        }`}
    >
      <div className="min-w-0 flex-1">
        <p className="font-heading text-xl">
          {item.name}
        </p>

        <p className="text-base text-pencil/70">
          {formatCents(item.unitPriceCents)} ·{" "}
          {formatWeight(item.unitWeight)} each
        </p>
      </div>

      <div
        className="flex items-center gap-2"
        role="group"
        aria-label={`Quantity of ${item.name}`}
      >
        <button
          type="button"
          className={stepButton}
          aria-label={`Remove one ${item.name}`}
          disabled={item.quantity <= 1 || isBusy}
          onClick={() =>
            onChange(
              item.productId,
              item.quantity - 1,
            )
          }
        >
          <Minus
            aria-hidden
            strokeWidth={3}
            className="h-4 w-4"
          />
        </button>

        <span
          className="w-8 text-center text-xl tabular-nums"
          aria-live="polite"
        >
          {item.quantity}
        </span>

        <button
          type="button"
          className={stepButton}
          aria-label={`Add one ${item.name}`}
          disabled={isBusy}
          onClick={() =>
            onChange(
              item.productId,
              item.quantity + 1,
            )
          }
        >
          <Plus
            aria-hidden
            strokeWidth={3}
            className="h-4 w-4"
          />
        </button>
      </div>

      <p className="w-20 text-right text-xl tabular-nums">
        {formatCents(
          item.unitPriceCents * item.quantity,
        )}
      </p>

      <button
        type="button"
        className={stepButton}
        aria-label={`Remove ${item.name} from cart`}
        disabled={isBusy}
        onClick={() =>
          onChange(item.productId, 0)
        }
      >
        <Trash2
          aria-hidden
          strokeWidth={2.5}
          className="h-4 w-4"
        />
      </button>
    </li>
  );
}
