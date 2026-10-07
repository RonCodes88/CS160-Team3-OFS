// Display helpers. Inputs are integers (cents, hundredths of a pound), so the
// string is built with integer math and never goes through a float.

function twoDecimals(value: number): string {
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  return `${sign}${Math.trunc(abs / 100).toLocaleString("en-US")}.${String(abs % 100).padStart(2, "0")}`;
}

/** 1299 -> "$12.99" */
export function formatCents(cents: number): string {
  const s = twoDecimals(cents);
  return s.startsWith("-") ? `-$${s.slice(1)}` : `$${s}`;
}

/** 1999 -> "19.99 lb" */
export function formatWeight(hundredthsLb: number): string {
  return `${twoDecimals(hundredthsLb)} lb`;
}
