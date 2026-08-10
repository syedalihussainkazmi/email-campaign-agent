import { redirect } from "next/navigation";
import { auth } from "@/auth/session";
import { AuthedShell } from "@/components/layout/authed-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { SignatureForm } from "@/components/campaign/signature-form";
import { SmtpAccountList } from "@/components/campaign/smtp-account-list";
import { RolloutPlannerPanel } from "@/components/campaign/rollout-planner-panel";
import { CapacityTimelinePanel } from "@/components/campaign/capacity-timeline-panel";
import { SendingWindowForm } from "@/components/campaign/sending-window-form";
import { getSignature } from "@/services/signature-service";
import { listSmtpAccounts } from "@/services/smtp-service";
import { getSendingWindow } from "@/services/sending-window-service";

export default async function SettingsPage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/");
  }

  const [signature, accounts, sendingWindow] = await Promise.all([
    getSignature(session.user.id),
    listSmtpAccounts(session.user.id),
    getSendingWindow(session.user.id),
  ]);

  return (
    <AuthedShell>
      <h1 className="mb-6 text-lg font-semibold text-zinc-100">Settings</h1>
      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Email Accounts</CardTitle>
            <CardDescription>Connect as many webmail accounts as you want to send from.</CardDescription>
          </CardHeader>
          <CardContent>
            <SmtpAccountList accounts={accounts} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Volume Calculator</CardTitle>
            <CardDescription>
              Plan a rollout from scratch, independent of what&apos;s currently connected.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <RolloutPlannerPanel />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Capacity Timeline</CardTitle>
            <CardDescription>
              Using the accounts you actually have connected right now, and their real ages.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CapacityTimelinePanel />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Sending Window</CardTitle>
            <CardDescription>Restrict campaigns to business hours for your audience&apos;s timezone.</CardDescription>
          </CardHeader>
          <CardContent>
            <SendingWindowForm initialValue={sendingWindow} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Email Signature</CardTitle>
            <CardDescription>Appended automatically to the end of every campaign you send.</CardDescription>
          </CardHeader>
          <CardContent>
            <SignatureForm initialValue={signature} />
          </CardContent>
        </Card>
      </div>
    </AuthedShell>
  );
}
