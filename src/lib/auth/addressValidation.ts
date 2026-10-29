// Input parsing for POST /api/addresses. Everything from the client is
// untrusted: only these text fields are copied, never coordinates, customer
// IDs or the default flag, which the server decides.

export type AddressInput = {
  label: string | null;
  line1: string;
  line2: string | null;
  city: string;
  /** Two-letter code, upper case. */
  state: string;
  postalCode: string;
};

export type ParsedAddress = { ok: true; value: AddressInput } | { ok: false; message: string };

const MAX_LENGTH = 120;

function text(body: Record<string, unknown>, key: string): string | null | undefined {
  const value = body[key];
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim().replace(/\s+/g, " ");
  return trimmed === "" ? null : trimmed;
}

/** Parses `{ label?, line1, line2?, city, state, postalCode }`. */
export function parseAddressInput(body: unknown): ParsedAddress {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, message: "Send the address as a JSON object." };
  }
  const record = body as Record<string, unknown>;
  const fields = {
    label: text(record, "label"),
    line1: text(record, "line1"),
    line2: text(record, "line2"),
    city: text(record, "city"),
    state: text(record, "state"),
    postalCode: text(record, "postalCode"),
  };
  if (Object.values(fields).some((value) => value === undefined)) {
    return { ok: false, message: "Address fields must be text." };
  }
  if (Object.values(fields).some((value) => value && value.length > MAX_LENGTH)) {
    return { ok: false, message: `Address fields must be at most ${MAX_LENGTH} characters.` };
  }
  if (!fields.line1) return { ok: false, message: "Enter a street address." };
  if (!fields.city) return { ok: false, message: "Enter a city." };
  const state = fields.state?.toUpperCase();
  if (!state || !/^[A-Z]{2}$/.test(state)) return { ok: false, message: "Enter a two-letter state code, like CA." };
  if (!fields.postalCode || !/^\d{5}(-\d{4})?$/.test(fields.postalCode)) {
    return { ok: false, message: "Enter a 5-digit ZIP code." };
  }
  return {
    ok: true,
    value: {
      label: fields.label ?? null,
      line1: fields.line1,
      line2: fields.line2 ?? null,
      city: fields.city,
      state,
      postalCode: fields.postalCode,
    },
  };
}

/** One line for geocoding and display: "87 N San Pedro St, San Jose, CA 95110". */
export function formatAddressLine(address: Pick<AddressInput, "line1" | "line2" | "city" | "state" | "postalCode">): string {
  const street = address.line2 ? `${address.line1} ${address.line2}` : address.line1;
  return `${street}, ${address.city}, ${address.state} ${address.postalCode}`;
}
