import { redirect } from "next/navigation";
import { auth, getDecryptedGoogleAccount } from "@/auth/auth";
import { AuthedShell } from "@/components/layout/authed-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default async function SettingsPage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/");
  }

  const account = await getDecryptedGoogleAccount(session.user.id);

  return (
    <AuthedShell>
      <h1 className="mb-6 text-lg font-semibold text-zinc-100">Settings</h1>
      <Card>
        <CardHeader>
          <CardTitle>Gmail Connection</CardTitle>
          <CardDescription>MailPilot sends campaigns through this connected account.</CardDescription>
        </CardHeader>
        <CardContent>
          {account ? (
            <Badge variant="success">Connected as {session.user.email}</Badge>
          ) : (
            <Badge variant="destructive">Not connected — please reconnect Gmail</Badge>
          )}
        </CardContent>
      </Card>
    </AuthedShell>
  );
}
