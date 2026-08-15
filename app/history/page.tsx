import { redirect } from "next/navigation";
import { auth } from "@/auth/session";
import { AuthedShell } from "@/components/layout/authed-shell";
import { listCampaigns } from "@/services/campaign-service";
import { CampaignList } from "@/components/campaign/campaign-list";

export default async function HistoryPage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/");
  }

  const { items } = await listCampaigns(session.user.id);

  return (
    <AuthedShell>
      <h1 className="mb-6 text-lg font-semibold text-zinc-100">Campaign History</h1>
      {items.length === 0 ? (
        <p className="text-sm text-zinc-500">No campaigns yet.</p>
      ) : (
        <CampaignList campaigns={items} variant="history" />
      )}
    </AuthedShell>
  );
}
