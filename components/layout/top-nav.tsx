import Link from "next/link";
import { auth, signOut } from "@/auth/session";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/brand/logo";

export async function TopNav() {
  const session = await auth();

  return (
    <header className="sticky top-0 z-10 flex items-center justify-between border-b border-zinc-800 bg-zinc-950/80 px-6 py-3 backdrop-blur-sm">
      <div className="flex items-center gap-6">
        <Logo />
        {session?.user?.email && (
          <span className="text-xs text-zinc-500">{session.user.email}</span>
        )}
      </div>

      <nav className="flex items-center gap-2">
        <Link href="/history">
          <Button variant="ghost" size="sm">History</Button>
        </Link>
        <Link href="/settings">
          <Button variant="ghost" size="sm">Settings</Button>
        </Link>
        {session?.user && (
          <form
            action={async () => {
              "use server";
              await signOut();
            }}
          >
            <Button variant="ghost" size="sm" type="submit">
              Logout
            </Button>
          </form>
        )}
      </nav>
    </header>
  );
}
