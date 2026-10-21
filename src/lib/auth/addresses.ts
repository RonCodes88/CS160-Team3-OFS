import type { SupabaseClient } from "@supabase/supabase-js";
import type { LatLng } from "@/lib/delivery/batching";

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
