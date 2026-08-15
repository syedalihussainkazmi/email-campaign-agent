import { redirect } from "next/navigation";
import { auth } from "@/auth/session";
import { AuthedShell } from "@/components/layout/authed-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { SmtpAccountList } from "@/components/campaign/smtp-account-list";
import { listSmtpAccounts } from "@/services/smtp-service";

export default async function WebmailsPage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/");
  }

  const accounts = await listSmtpAccounts(session.user.id);

  return (
    <AuthedShell>
      <h1 className="mb-6 text-lg font-semibold text-zinc-100">Webmails</h1>
      <Card>
        <CardHeader>
          <CardTitle>Email Accounts</CardTitle>
          <CardDescription>Connect as many webmail accounts as you want to send from.</CardDescription>
        </CardHeader>
        <CardContent>
          <SmtpAccountList accounts={accounts} />
        </CardContent>
      </Card>
    </AuthedShell>
  );
}
