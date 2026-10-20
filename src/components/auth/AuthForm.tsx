"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { homeFor } from "@/lib/auth/redirects";
import type { Role } from "@/lib/auth/session";

type Mode = "login" | "register";

const copy = {
  login: { submit: "Log in", busy: "Logging in...", endpoint: "/api/auth/login" },
  register: { submit: "Create account", busy: "Creating account...", endpoint: "/api/auth/register" },
} as const;

const inputClass =
  "mt-1 h-12 w-full rounded-wobbly border-2 border-pencil bg-white px-4 text-lg placeholder:text-pencil/40 focus:border-pen focus:outline-none focus:ring-2 focus:ring-pen/20 disabled:opacity-60";

type Props = {
  mode: Mode;
  /** Where to go after signing in; when null, the user's home for their role. */
  next: string | null;
};

export function AuthForm({ mode, next }: Props) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const text = copy[mode];

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(text.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: form.get("email"), password: form.get("password") }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error?.message ?? "Something went wrong. Please try again.");
        setBusy(false);
        return;
      }
      router.replace(next ?? homeFor(data.user.role as Role));
      router.refresh();
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
      setBusy(false);
    }
  }

  return (
    <form className="mt-6 space-y-4" onSubmit={onSubmit}>
      <div
        role="alert"
        className={error ? "flex items-start gap-3 rounded-wobbly-md border-[3px] border-marker bg-white p-3 text-lg" : "sr-only"}
      >
        {error && (
          <>
            <AlertTriangle aria-hidden strokeWidth={2.5} className="mt-1 h-5 w-5 shrink-0 text-marker" />
            <p>{error}</p>
          </>
        )}
      </div>
      <label className="block">
        <span className="text-lg">Email</span>
        <input
          name="email"
          type="email"
          required
          autoComplete="email"
          placeholder="you@example.com"
          disabled={busy}
          className={inputClass}
        />
      </label>
      <label className="block">
        <span className="text-lg">Password</span>
        <input
          name="password"
          type="password"
          required
          minLength={mode === "register" ? 8 : undefined}
          maxLength={128}
          autoComplete={mode === "register" ? "new-password" : "current-password"}
          placeholder="••••••••"
          disabled={busy}
          aria-describedby={mode === "register" ? "password-hint" : undefined}
          className={inputClass}
        />
        {mode === "register" && (
          <span id="password-hint" className="mt-1 block text-base text-pencil/70">
            At least 8 characters.
          </span>
        )}
      </label>
      <Button type="submit" disabled={busy} className="w-full">
        {busy ? text.busy : text.submit}
      </Button>
      <p className="text-lg">
        {mode === "login" ? (
          <>
            New here?{" "}
            <Link href={withNext("/register", next)} className="underline decoration-marker">
              Create an account
            </Link>
          </>
        ) : (
          <>
            Already have an account?{" "}
            <Link href={withNext("/login", next)} className="underline decoration-marker">
              Log in
            </Link>
          </>
        )}
      </p>
    </form>
  );
}

function withNext(path: string, next: string | null) {
  return next ? `${path}?next=${encodeURIComponent(next)}` : path;
}
