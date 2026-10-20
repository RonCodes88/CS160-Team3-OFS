"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/Button";

export function LogoutButton({ className, onDone }: { className?: string; onDone?: () => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function logout() {
    setBusy(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      onDone?.();
      router.replace("/");
      router.refresh();
      setBusy(false);
    }
  }

  return (
    <Button variant="secondary" onClick={logout} disabled={busy} className={className}>
      {busy ? "Logging out..." : "Log out"}
    </Button>
  );
}
