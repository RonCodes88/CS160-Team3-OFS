import Link from "next/link";
import { Suspense } from "react";
import { authLinks, navLinks } from "./navLinks";
import { BadgeShell, SupabaseBadge } from "./SupabaseBadge";

const columns = [
  { title: "Explore", links: navLinks },
  {
    title: "Account",
    links: [
      { href: authLinks.login, label: "Log in" },
      { href: authLinks.register, label: "Sign up" },
    ],
  },
];

export function Footer() {
  return (
    <footer className="border-t-2 border-dashed border-pencil">
      <div className="mx-auto grid max-w-5xl gap-10 px-6 py-12 md:grid-cols-3">
        <div>
          <p className="font-heading text-3xl">OFS</p>
          <p className="mt-2 text-lg">
            Fresh groceries from Downtown San Jose, rolled to your door by a friendly robot.
          </p>
        </div>

        {columns.map((col) => (
          <div key={col.title}>
            <h2 className="wavy-underline text-2xl decoration-marker">{col.title}</h2>
            <ul className="mt-4 space-y-2 text-lg">
              {col.links.map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className="hover:line-through decoration-2">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="mx-auto flex max-w-5xl flex-col items-start gap-3 px-6 pb-8 text-base md:flex-row md:items-center md:justify-between">
        <p>Made with pencils &amp; robots · CS160 Team 3</p>
        <Suspense fallback={<BadgeShell>Supabase: checking…</BadgeShell>}>
          <SupabaseBadge />
        </Suspense>
      </div>
    </footer>
  );
}
