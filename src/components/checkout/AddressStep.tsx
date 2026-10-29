"use client";

import { useState, type ComponentProps, type FormEvent } from "react";
import { MapPin, Plus } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { formatAddress, saveAddress, type SavedAddress } from "./checkoutApi";

const inputClass =
  "mt-1 h-12 w-full rounded-wobbly border-2 border-pencil bg-white px-4 text-lg placeholder:text-pencil/40 focus:border-pen focus:outline-none focus:ring-2 focus:ring-pen/20 disabled:opacity-60";

type Props = {
  addresses: SavedAddress[];
  selectedId: string | null;
  /** The address the summary below was priced for, once the customer confirms it. */
  confirmedId: string | null;
  /** Locked while a payment is in progress; changing it means canceling that payment first. */
  locked: boolean;
  busy: boolean;
  onSelect(id: string): void;
  onAdded(address: SavedAddress): void;
  onConfirm(): void;
  onChange(): void;
};

/** Pick a saved address or add one, then confirm where the order goes. */
export function AddressStep({ addresses, selectedId, confirmedId, locked, busy, onSelect, onAdded, onConfirm, onChange }: Props) {
  const [adding, setAdding] = useState(addresses.length === 0);
  const confirmed = addresses.find((a) => a.id === confirmedId);

  if (confirmed) {
    return (
      <Card>
        <h2 className="text-3xl">1. Delivery address</h2>
        <p className="mt-4 flex items-start gap-3 text-xl">
          <MapPin aria-hidden strokeWidth={2.5} className="mt-1 h-6 w-6 shrink-0" />
          <span>
            {confirmed.label && <span className="block font-heading">{confirmed.label}</span>}
            {formatAddress(confirmed)}
          </span>
        </p>
        <button type="button" onClick={onChange} disabled={busy}
          className="mt-4 text-lg underline decoration-marker disabled:opacity-50">
          {locked ? "Change address (cancels this payment)" : "Change address"}
        </button>
      </Card>
    );
  }

  return (
    <Card>
      <h2 className="text-3xl">1. Delivery address</h2>
      <p className="mt-2 text-lg text-pencil/70">We deliver within Downtown San Jose.</p>

      {addresses.length > 0 && (
        <fieldset className="mt-6 space-y-3">
          <legend className="sr-only">Saved addresses</legend>
          {addresses.map((address) => (
            <label key={address.id}
              className="flex cursor-pointer items-start gap-3 rounded-wobbly border-2 border-pencil bg-white p-4 text-lg has-[:checked]:bg-postit has-[:checked]:shadow-hard-sm">
              <input type="radio" name="address" value={address.id} checked={selectedId === address.id}
                onChange={() => onSelect(address.id)} className="mt-1.5 h-5 w-5 accent-pen" />
              <span>
                {address.label && <span className="block font-heading">{address.label}</span>}
                {formatAddress(address)}
              </span>
            </label>
          ))}
        </fieldset>
      )}

      {adding ? (
        <AddressForm
          canCancel={addresses.length > 0}
          onCancel={() => setAdding(false)}
          onSaved={(address) => {
            setAdding(false);
            onAdded(address);
          }}
        />
      ) : (
        <button type="button" onClick={() => setAdding(true)}
          className="mt-4 inline-flex items-center gap-2 text-lg underline decoration-marker">
          <Plus aria-hidden strokeWidth={2.5} className="h-5 w-5" /> Add a new address
        </button>
      )}

      {!adding && (
        <Button className="mt-6 w-full" disabled={!selectedId || busy} onClick={onConfirm}>
          {busy ? "Checking…" : "Deliver here"}
        </Button>
      )}
    </Card>
  );
}

function AddressForm({ canCancel, onCancel, onSaved }: {
  canCancel: boolean;
  onCancel(): void;
  onSaved(address: SavedAddress): void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const fields = Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>;
    try {
      const result = await saveAddress(fields);
      if (result.ok) onSaved(result.address);
      else setError(result.error.message);
    } catch {
      setError("Network error while saving the address.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="mt-6 space-y-4" onSubmit={onSubmit} aria-label="New address">
      <p role="alert" aria-live="assertive"
        className={error ? "rounded-wobbly-md border-[3px] border-marker bg-white p-3 text-lg" : "sr-only"}>
        {error}
      </p>
      <Field label="Street address" name="line1" autoComplete="address-line1" required disabled={busy} />
      <Field label="Apt, suite (optional)" name="line2" autoComplete="address-line2" disabled={busy} />
      <div className="grid gap-4 sm:grid-cols-[1fr_6rem_8rem]">
        <Field label="City" name="city" autoComplete="address-level2" defaultValue="San Jose" required disabled={busy} />
        <Field label="State" name="state" autoComplete="address-level1" defaultValue="CA" maxLength={2} required disabled={busy} />
        <Field label="ZIP" name="postalCode" autoComplete="postal-code" inputMode="numeric" required disabled={busy} />
      </div>
      <Field label="Label (optional)" name="label" placeholder="Home, Work…" disabled={busy} />
      <div className="flex flex-wrap gap-3">
        <Button type="submit" disabled={busy}>{busy ? "Checking address…" : "Save address"}</Button>
        {canCancel && <Button type="button" variant="secondary" onClick={onCancel} disabled={busy}>Cancel</Button>}
      </div>
    </form>
  );
}

function Field({ label, ...props }: { label: string } & ComponentProps<"input">) {
  return (
    <label className="block">
      <span className="text-lg">{label}</span>
      <input {...props} className={inputClass} />
    </label>
  );
}
