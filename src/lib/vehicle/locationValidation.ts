export type VehicleLocationInput = {
  latitude: number;
  longitude: number;
  batteryPercent: number;
};

type ValidationResult =
  | { ok: true; value: VehicleLocationInput }
  | { ok: false; message: string };

export function parseVehicleLocationBody(body: unknown): ValidationResult {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, message: "Body must be an object." };
  }

  const { latitude, longitude, batteryPercent } =
    body as Record<string, unknown>;

  if (
    typeof latitude !== "number" ||
    !Number.isFinite(latitude) ||
    latitude < -90 ||
    latitude > 90
  ) {
    return { ok: false, message: "latitude must be between -90 and 90." };
  }

  if (
    typeof longitude !== "number" ||
    !Number.isFinite(longitude) ||
    longitude < -180 ||
    longitude > 180
  ) {
    return { ok: false, message: "longitude must be between -180 and 180." };
  }

  if (
    typeof batteryPercent !== "number" ||
    !Number.isInteger(batteryPercent) ||
    batteryPercent < 0 ||
    batteryPercent > 100
  ) {
    return { ok: false, message: "batteryPercent must be an integer from 0 to 100." };
  }

  return {
    ok: true,
    value: { latitude, longitude, batteryPercent },
  };
}
