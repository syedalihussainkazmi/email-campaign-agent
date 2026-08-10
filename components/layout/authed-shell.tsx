import { redirect } from "next/navigation";
import { auth } from "@/auth/session";
import { TopNav } from "@/components/layout/top-nav";

/** Wraps a page in the standard signed-in shell, redirecting to the landing page if unauthenticated. */
export async function AuthedShell({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) {
    redirect("/");
  }

  return (
    <div className="flex min-h-screen flex-col bg-zinc-950">
      <TopNav />
      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-8">{children}</main>
    </div>
  );
}
