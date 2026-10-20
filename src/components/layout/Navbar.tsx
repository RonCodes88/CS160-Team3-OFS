import Link from "next/link";
import { Bot } from "lucide-react";
import { LogoutButton } from "@/components/auth/LogoutButton";
import { Button } from "@/components/ui/Button";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { MobileMenu } from "./MobileMenu";
import { authLinks, navLinks } from "./navLinks";

export async function Navbar() {
  const user = await getCurrentUser();

  return (
    <header className="relative z-20 border-b-2 border-dashed border-pencil bg-paper/90">
      <nav
        aria-label="Main"
        className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-6 py-4"
      >
        <Link href="/" className="group flex items-center gap-2">
          <span className="inline-flex h-11 w-11 items-center justify-center rounded-blob border-[3px] border-pencil bg-postit transition-transform duration-100 group-hover:-rotate-6">
            <Bot aria-hidden strokeWidth={2.5} className="h-6 w-6" />
          </span>
          <span className="font-heading text-3xl">OFS</span>
        </Link>

        <ul className="hidden items-center gap-6 text-xl lg:flex">
          {navLinks.map((link) => (
            <li key={link.href}>
              <Link
                href={link.href}
                className="decoration-marker hover:wavy-underline"
              >
                {link.label}
              </Link>
            </li>
          ))}
        </ul>

        <div className="hidden items-center gap-3 lg:flex">
          {user ? (
            <>
              <span className="max-w-48 truncate text-lg" title={user.email}>
                {user.email}
              </span>
              <LogoutButton />
            </>
          ) : (
            <>
              <Button href={authLinks.login} variant="secondary">
                Log in
              </Button>
              <Button href={authLinks.register}>Sign up</Button>
            </>
          )}
        </div>

        <MobileMenu userEmail={user?.email ?? null} />
      </nav>
    </header>
  );
}
