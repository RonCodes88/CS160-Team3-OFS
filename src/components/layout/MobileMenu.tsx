"use client";

import Link from "next/link";
import { useState } from "react";
import { Menu, X } from "lucide-react";
import { LogoutButton } from "@/components/auth/LogoutButton";
import { Button } from "@/components/ui/Button";
import { authLinks, navLinks } from "./navLinks";

export function MobileMenu({ userEmail }: { userEmail: string | null }) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  return (
    <div className="lg:hidden">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="mobile-menu"
        aria-label={open ? "Close menu" : "Open menu"}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex h-12 w-12 items-center justify-center rounded-wobbly border-[3px] border-pencil bg-white shadow-hard transition-all duration-100 active:translate-x-[4px] active:translate-y-[4px] active:shadow-none"
      >
        {open ? (
          <X aria-hidden strokeWidth={3} className="h-6 w-6" />
        ) : (
          <Menu aria-hidden strokeWidth={3} className="h-6 w-6" />
        )}
      </button>

      {open && (
        <div
          id="mobile-menu"
          className="absolute inset-x-6 top-full mt-2 rotate-1 rounded-wobbly-md border-[3px] border-pencil bg-white p-6 shadow-hard-lg"
        >
          <ul className="flex flex-col gap-4 text-2xl">
            {navLinks.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  onClick={close}
                  className="decoration-marker hover:wavy-underline"
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
          <div className="mt-6 flex flex-col gap-3 border-t-2 border-dashed border-pencil pt-6">
            {userEmail ? (
              <>
                <p className="truncate text-lg">Signed in as {userEmail}</p>
                <LogoutButton onDone={close} />
              </>
            ) : (
              <>
                <Button href={authLinks.login} variant="secondary" onClick={close}>
                  Log in
                </Button>
                <Button href={authLinks.register} onClick={close}>
                  Sign up
                </Button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
