import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@/auth/auth";
import { AuthedShell } from "@/components/layout/authed-shell";
import { getCampaignDetail } from "@/services/campaign-service";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const CAMPAIGN_STATUS_VARIANT = {
  draft: "default",
  running: "warning",
  paused: "warning",
  completed: "success",
  failed: "destructive",
} as const;

const RECIPIENT_STATUS_VARIANT = {
  pending: "default",
  sending: "warning",
  sent: "success",
  failed: "destructive",
} as const;

export default async function CampaignDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) {
    redirect("/");
  }

  const { id } = await params;
  const campaign = await getCampaignDetail(session.user.id, id);
  if (!campaign) {
    notFound();
  }

  const pendingCount = campaign.totalCount - campaign.sentCount;

  return (
    <AuthedShell>
      <div className="flex flex-col gap-6">
        <div>
          <Link href="/history" className="text-xs text-zinc-500 hover:text-zinc-300">
            &larr; Back to History
          </Link>
        </div>

        <Card>
          <CardHeader className="flex-row items-start justify-between space-y-0">
            <div>
              <CardTitle>{campaign.subject}</CardTitle>
              <CardDescription>
                Created {campaign.createdAt.toLocaleString()}
                {campaign.startedAt && ` · Started ${campaign.startedAt.toLocaleString()}`}
                {campaign.completedAt && ` · Completed ${campaign.completedAt.toLocaleString()}`}
              </CardDescription>
            </div>
            <Badge variant={CAMPAIGN_STATUS_VARIANT[campaign.status]}>{campaign.status}</Badge>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
              <Stat label="Total Recipients" value={campaign.totalCount} />
              <Stat label="Sent" value={campaign.sentCount} />
              <Stat label="Delivered" value={campaign.deliveredCount} variant="success" />
              <Stat label="Failed" value={campaign.failedCount} variant="destructive" />
              <Stat label="Remaining" value={Math.max(0, pendingCount)} />
            </div>
            {campaign.avgIntervalSeconds != null && (
              <p className="mt-4 text-xs text-zinc-500">
                Average interval between sends: ~{Math.round(campaign.avgIntervalSeconds)}s
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recipients ({campaign.recipients.length})</CardTitle>
            <CardDescription>Every recipient in this campaign and their individual status.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="max-h-[600px] overflow-auto rounded-lg border border-zinc-800">
              <table className="w-full text-left text-sm text-zinc-300">
                <thead className="sticky top-0 bg-zinc-950 text-xs uppercase text-zinc-500">
                  <tr>
                    <th className="px-3 py-2">Email</th>
                    <th className="px-3 py-2">Business</th>
                    <th className="px-3 py-2">Owner</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Sent At</th>
                    <th className="px-3 py-2">Error</th>
                  </tr>
                </thead>
                <tbody>
                  {campaign.recipients.map((cr) => (
                    <tr key={cr.id} className="border-t border-zinc-800">
                      <td className="px-3 py-2">{cr.recipient.email}</td>
                      <td className="px-3 py-2 text-zinc-400">{cr.name || "—"}</td>
                      <td className="px-3 py-2 text-zinc-400">{cr.ownerName || "—"}</td>
                      <td className="px-3 py-2">
                        <Badge variant={RECIPIENT_STATUS_VARIANT[cr.status]}>{cr.status}</Badge>
                      </td>
                      <td className="px-3 py-2 text-zinc-500">
                        {cr.sentAt ? cr.sentAt.toLocaleString() : "—"}
                      </td>
                      <td className="px-3 py-2 text-red-400">{cr.error || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </AuthedShell>
  );
}

function Stat({
  label,
  value,
  variant,
}: {
  label: string;
  value: number;
  variant?: "success" | "destructive";
}) {
  const color =
    variant === "success" ? "text-emerald-400" : variant === "destructive" ? "text-red-400" : "text-zinc-100";
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-zinc-500">{label}</span>
      <span className={`text-2xl font-semibold ${color}`}>{value}</span>
    </div>
  );
}
