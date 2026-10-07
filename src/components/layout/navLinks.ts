// Placeholder feature routes. Each points to a "coming soon" stub until built.
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
