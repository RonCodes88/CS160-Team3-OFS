import type { SupabaseClient } from "@supabase/supabase-js";

export type StopStatus = "ARRIVED" | "DELIVERED";

export type StopStatusResult =
  | {
      ok: true;
      stop: { id: string; status: StopStatus };
      tripCompleted: boolean;
    }
  | {
      ok: false;
      reason: "NOT_FOUND" | "INVALID_TRANSITION";
    };

export async function updateDeliveryStopStatus(
  db: SupabaseClient,
  userId: string,
  stopId: string,
  status: StopStatus,
): Promise<StopStatusResult> {
  const { data, error } = await db.rpc("vehicle_update_delivery_stop", {
    p_vehicle_user_id: userId,
    p_stop_id: stopId,
    p_status: status,
  });

  if (error) {
    throw new Error(`Delivery stop update failed: ${error.message}`);
  }

  if (!data || typeof data !== "object" || !("ok" in data)) {
    throw new Error("Invalid delivery stop update response");
  }

  return data as StopStatusResult;
}
