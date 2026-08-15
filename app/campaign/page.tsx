import { redirect } from "next/navigation";
import { auth } from "@/auth/session";
import { AuthedShell } from "@/components/layout/authed-shell";
import { CampaignRunnerForm } from "@/components/campaign/campaign-runner-form";

export default async function CampaignPage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/");
  }

  return (
    <AuthedShell>
      <CampaignRunnerForm />
    </AuthedShell>
  );
}
