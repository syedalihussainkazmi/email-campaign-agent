import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/auth/session";
import { AuthedShell } from "@/components/layout/authed-shell";
import { listCampaigns } from "@/services/campaign-service";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const STATUS_VARIANT = {
  draft: "default",
  running: "warning",
  paused: "warning",
  completed: "success",
  failed: "destructive",
} as const;

export default async function HistoryPage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/");
  }

  const { items } = await listCampaigns(session.user.id);

  return (
    <AuthedShell>
      <h1 className="mb-6 text-lg font-semibold text-zinc-100">Campaign History</h1>
      <div className="flex flex-col gap-3">
        {items.length === 0 && <p className="text-sm text-zinc-500">No campaigns yet.</p>}
        {items.map((c) => (
          <Link key={c.id} href={`/history/${c.id}`}>
            <Card className="transition-colors hover:border-zinc-700">
              <CardHeader className="flex-row items-center justify-between space-y-0">
                <div>
                  <CardTitle>{c.subject}</CardTitle>
                  <CardDescription>{c.createdAt.toLocaleString()}</CardDescription>
                </div>
                <Badge variant={STATUS_VARIANT[c.status]}>{c.status}</Badge>
              </CardHeader>
              <CardContent className="flex gap-6 text-xs text-zinc-400">
                <span>Total: {c.totalCount}</span>
                <span>Delivered: {c.deliveredCount}</span>
                <span>Failed: {c.failedCount}</span>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </AuthedShell>
  );
}
