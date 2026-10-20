import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth/AuthForm";
import { AuthPage } from "@/components/auth/AuthPage";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { homeFor, safeNextPath } from "@/lib/auth/redirects";

export const metadata: Metadata = { title: "Sign up — OFS" };

export default async function Page({ searchParams }: PageProps<"/register">) {
  const next = safeNextPath((await searchParams).next);
  const user = await getCurrentUser();
  if (user) redirect(next ?? homeFor(user.role));

  return (
    <AuthPage title="Sign up" description="Create a customer account to start ordering.">
      <AuthForm mode="register" next={next} />
    </AuthPage>
  );
}
