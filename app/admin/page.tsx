import { getAdminStats } from "@/services/admin-service";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default async function AdminDashboardPage() {
  const stats = await getAdminStats();

  const tiles = [
    { label: "Users", value: stats.userCount },
    { label: "Campaigns", value: stats.campaignCount },
    { label: "Emails Sent", value: stats.sentTotal },
    { label: "Emails Failed", value: stats.failedTotal },
  ];

  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
      {tiles.map((tile) => (
        <Card key={tile.label}>
          <CardHeader>
            <CardTitle className="text-xs font-normal text-zinc-500">{tile.label}</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold text-zinc-100">{tile.value}</CardContent>
        </Card>
      ))}
    </div>
  );
}
