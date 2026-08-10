import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/auth/session";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user || session.user.role !== "admin") {
    redirect("/");
  }

  return (
    <div className="flex min-h-screen bg-zinc-950">
      <aside className="w-48 border-r border-zinc-800 p-4">
        <p className="mb-4 text-xs font-semibold uppercase tracking-wider text-zinc-500">Admin</p>
        <nav className="flex flex-col gap-1 text-sm text-zinc-300">
          <Link href="/admin" className="rounded px-2 py-1 hover:bg-zinc-800">Dashboard</Link>
          <Link href="/admin/campaigns" className="rounded px-2 py-1 hover:bg-zinc-800">Campaigns</Link>
          <Link href="/admin/users" className="rounded px-2 py-1 hover:bg-zinc-800">Users</Link>
          <Link href="/admin/logs" className="rounded px-2 py-1 hover:bg-zinc-800">Logs</Link>
        </nav>
      </aside>
      <main className="flex-1 p-8">{children}</main>
    </div>
  );
}
