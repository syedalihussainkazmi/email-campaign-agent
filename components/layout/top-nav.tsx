import Link from "next/link";
import { auth, signOut } from "@/auth/session";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/brand/logo";

const NAV_LINKS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/campaign", label: "Campaign" },
  { href: "/webmails", label: "Webmails" },
  { href: "/calculator", label: "Calculator" },
  { href: "/history", label: "History" },
  { href: "/settings", label: "Settings" },
];

export async function TopNav() {
  const session = await auth();

  return (
    <header className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800 bg-zinc-950/80 px-6 py-3 backdrop-blur-sm">
      <div className="flex items-center gap-6">
        <Logo />
        {session?.user?.email && <span className="text-xs text-zinc-500">{session.user.email}</span>}
      </div>

      <nav className="flex flex-wrap items-center gap-1">
        {NAV_LINKS.map((link) => (
          <Link key={link.href} href={link.href}>
            <Button
              variant="ghost"
              size="sm"
              className="transition-colors hover:bg-zinc-800 hover:text-zinc-100"
            >
              {link.label}
            </Button>
          </Link>
        ))}
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
