import type { SupabaseClient } from "@supabase/supabase-js";
import type { VehicleLocationInput } from "./locationValidation";

export type VehicleLocation = VehicleLocationInput & {
  updatedAt: string;
};

export async function updateVehicleLocation(
  db: SupabaseClient,
  userId: string,
  input: VehicleLocationInput,
): Promise<VehicleLocation | null> {
  const { data, error } = await db
    .from("vehicles")
    .update({
      last_location: `SRID=4326;POINT(${input.longitude} ${input.latitude})`,
      battery_percent: input.batteryPercent,
      last_update_at: new Date().toISOString(),
    })
    .eq("user_id", userId)
    .select("battery_percent, last_update_at")
    .maybeSingle();

  if (error) {
    throw new Error(`Vehicle location update failed: ${error.message}`);
  }

  if (!data) return null;

  return {
    latitude: input.latitude,
    longitude: input.longitude,
    batteryPercent: data.battery_percent,
    updatedAt: data.last_update_at,
  };
}
