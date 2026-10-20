// Main navigation. Pages that are not built yet show a "coming soon" stub.
export const navLinks = [
  { href: "/shop", label: "Shop" },
  { href: "/cart", label: "Cart" },
  { href: "/track", label: "Track My Order" },
  { href: "/#how-it-works", label: "How It Works" },
  { href: "/staff", label: "Staff" },
] as const;

export const authLinks = {
  login: "/login",
  register: "/register",
} as const;
