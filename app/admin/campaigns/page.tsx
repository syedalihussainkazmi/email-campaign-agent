import { searchCampaignsAdmin } from "@/services/admin-service";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default async function AdminCampaignsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string }>;
}) {
  const { q, status } = await searchParams;
  const { items, total } = await searchCampaignsAdmin(q ?? "", status);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-zinc-100">Campaigns ({total})</h1>
        <a
          href={`/api/admin/campaigns/export?format=csv${q ? `&q=${q}` : ""}`}
          className="text-xs text-zinc-400 underline"
        >
          Export CSV
        </a>
        <a
          href={`/api/admin/campaigns/export?format=json${q ? `&q=${q}` : ""}`}
          className="text-xs text-zinc-400 underline"
        >
          Export JSON
        </a>
      </div>

      <form className="flex gap-2">
        <input
          name="q"
          defaultValue={q}
          placeholder="Search subject…"
          className="h-9 rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-100"
        />
      </form>

      <div className="flex flex-col gap-3">
        {items.map((c) => (
          <Card key={c.id}>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle>{c.subject}</CardTitle>
                <CardDescription>{c.user.email}</CardDescription>
              </div>
              <Badge>{c.status}</Badge>
            </CardHeader>
            <CardContent className="flex gap-6 text-xs text-zinc-400">
              <span>Sent: {c.sentCount}/{c.totalCount}</span>
              <span>Failed: {c.failedCount}</span>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
