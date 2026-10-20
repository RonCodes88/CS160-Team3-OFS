import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth/AuthForm";
import { AuthPage } from "@/components/auth/AuthPage";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { homeFor, safeNextPath } from "@/lib/auth/redirects";

export const metadata: Metadata = { title: "Log in — OFS" };

export default async function Page({ searchParams }: PageProps<"/login">) {
  const next = safeNextPath((await searchParams).next);
  const user = await getCurrentUser();
  if (user) redirect(next ?? homeFor(user.role));

  return (
    <AuthPage title="Log in" description="Welcome back! Log in to shop and track your orders.">
      <AuthForm mode="login" next={next} />
    </AuthPage>
  );
}
