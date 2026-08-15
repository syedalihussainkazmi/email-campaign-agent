import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/auth/session";
import { AuthedShell } from "@/components/layout/authed-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CampaignList } from "@/components/campaign/campaign-list";
import { listCampaigns } from "@/services/campaign-service";
import { prisma } from "@/database/prisma";

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/");
  }

  const [{ items: allCampaigns, total }, aggregate] = await Promise.all([
    listCampaigns(session.user.id, 1, 100),
    prisma.campaign.aggregate({
      where: { userId: session.user.id },
      _sum: { sentCount: true, deliveredCount: true, failedCount: true },
    }),
  ]);

  const active = allCampaigns.filter((c) => c.status === "running" || c.status === "paused");

  const tiles = [
    { label: "Total Campaigns", value: total },
    { label: "Emails Sent", value: aggregate._sum.sentCount ?? 0 },
    { label: "Delivered", value: aggregate._sum.deliveredCount ?? 0 },
    { label: "Failed", value: aggregate._sum.failedCount ?? 0 },
  ];

  return (
    <AuthedShell>
      <div className="flex items-center justify-between">
        <h1 className="mb-6 text-lg font-semibold text-zinc-100">Dashboard</h1>
        <Link href="/campaign">
          <Button size="sm">New Campaign</Button>
        </Link>
      </div>

      <div className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {tiles.map((tile) => (
          <Card key={tile.label}>
            <CardHeader>
              <CardTitle className="text-xs font-normal text-zinc-500">{tile.label}</CardTitle>
            </CardHeader>
            <CardContent className="text-2xl font-semibold text-zinc-100">{tile.value}</CardContent>
          </Card>
        ))}
      </div>

      <h2 className="mb-3 text-sm font-semibold text-zinc-300">Active Campaigns</h2>
      {active.length === 0 ? (
        <p className="text-sm text-zinc-500">No running or paused campaigns.</p>
      ) : (
        <CampaignList campaigns={active} variant="dashboard" />
      )}
    </AuthedShell>
  );
}
