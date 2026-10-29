import type { SupabaseClient } from "@supabase/supabase-js";
import type { LatLng } from "@/lib/delivery/batching";
import { formatAddressLine, type AddressInput } from "./addressValidation";

export type OwnedAddress = { id: string; customerId: string; location: LatLng | null };
type AddressRow = { id: string; customer_id: string; latitude: number | null; longitude: number | null };

/**
 * Read one saved address for a verified customer ID, never an ID from the body.
 * The SQL RPC filters ownership and active CUSTOMER status and extracts numeric
 * coordinates from PostGIS geography. It does not geocode or edit the address.
 * Missing and foreign addresses both return null to avoid disclosing ownership.
 */
export async function getOwnedAddress(db: SupabaseClient, customerId: string, addressId: string): Promise<OwnedAddress | null> {
  const { data, error } = await db.rpc("customer_read_address_location", {
    p_customer_id: customerId, p_address_id: addressId,
  });
  if (error) throw new Error(`getOwnedAddress failed: ${error.message}`);
  // RETURNS TABLE produces an array even though the address primary key allows
  // at most one match. Recheck identity before passing data to checkout.
  const row = (data as AddressRow[] | null)?.[0];
  if (!row || row.customer_id !== customerId || row.id !== addressId) return null;
  return {
    id: row.id, customerId: row.customer_id,
    location: row.latitude === null || row.longitude === null ? null : { lat: row.latitude, lng: row.longitude },
  };
}

/** A saved address as the customer sees it. Coordinates stay server-side. */
export type SavedAddress = {
  id: string;
  label: string | null;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  postalCode: string;
  isDefault: boolean;
};

type SavedAddressRow = {
  id: string; label: string | null; line_1: string; line_2: string | null;
  city: string; state: string; postal_code: string; is_default: boolean;
};

const SAVED_COLUMNS = "id, label, line_1, line_2, city, state, postal_code, is_default";

function toSavedAddress(row: SavedAddressRow): SavedAddress {
  return {
    id: row.id, label: row.label, line1: row.line_1, line2: row.line_2,
    city: row.city, state: row.state, postalCode: row.postal_code, isDefault: row.is_default,
  };
}

/** The customer's saved addresses, default first, then newest first. */
export async function listAddresses(db: SupabaseClient, customerId: string): Promise<SavedAddress[]> {
  const { data, error } = await db.from("addresses").select(SAVED_COLUMNS)
    .eq("customer_id", customerId)
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) throw new Error(`listAddresses failed: ${error.message}`);
  return (data as SavedAddressRow[]).map(toSavedAddress);
}

export type CreateAddressResult =
  | { ok: true; address: SavedAddress }
  | { ok: false; reason: "NOT_FOUND" | "OUTSIDE_AREA" };

export type CreateAddressDependencies = {
  geocode(query: string): Promise<LatLng | null>;
  /** Throws ServiceAreaUnavailable when the area is not configured. */
  isDeliverable(point: LatLng): boolean;
};

/**
 * Geocodes and saves an address for a verified customer ID. Addresses Mapbox
 * can't place, or that fall outside the service area, are rejected before
 * anything is written. A customer's first address becomes their default.
 */
export async function createAddress(
  db: SupabaseClient,
  customerId: string,
  input: AddressInput,
  deps: CreateAddressDependencies,
): Promise<CreateAddressResult> {
  const point = await deps.geocode(formatAddressLine(input));
  if (!point) return { ok: false, reason: "NOT_FOUND" };
  if (!deps.isDeliverable(point)) return { ok: false, reason: "OUTSIDE_AREA" };

  const { count, error: countError } = await db.from("addresses")
    .select("id", { count: "exact", head: true }).eq("customer_id", customerId);
  if (countError) throw new Error(`createAddress failed: ${countError.message}`);

  const row = {
    customer_id: customerId, label: input.label, line_1: input.line1, line_2: input.line2,
    city: input.city, state: input.state, postal_code: input.postalCode,
    // EWKT is accepted by the geography column; longitude comes first.
    location: `SRID=4326;POINT(${point.lng} ${point.lat})`,
  };
  const insert = (isDefault: boolean) =>
    db.from("addresses").insert({ ...row, is_default: isDefault }).select(SAVED_COLUMNS).single();

  let { data, error } = await insert(count === 0);
  // Two first addresses saved at once: the partial unique index keeps one default.
  if (error?.code === "23505" && count === 0) ({ data, error } = await insert(false));
  if (error) throw new Error(`createAddress failed: ${error.message}`);
  return { ok: true, address: toSavedAddress(data as SavedAddressRow) };
}
