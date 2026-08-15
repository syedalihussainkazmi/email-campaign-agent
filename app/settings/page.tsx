import { redirect } from "next/navigation";
import { auth } from "@/auth/session";
import { AuthedShell } from "@/components/layout/authed-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { SignatureForm } from "@/components/campaign/signature-form";
import { SendingWindowForm } from "@/components/campaign/sending-window-form";
import { getSignature } from "@/services/signature-service";
import { getSendingWindow } from "@/services/sending-window-service";

export default async function SettingsPage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/");
  }

  const [signature, sendingWindow] = await Promise.all([
    getSignature(session.user.id),
    getSendingWindow(session.user.id),
  ]);

  return (
    <AuthedShell>
      <h1 className="mb-6 text-lg font-semibold text-zinc-100">Settings</h1>
      <div className="flex flex-col gap-6">
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
