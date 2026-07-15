import { redirect } from "next/navigation";
import { auth, getDecryptedGoogleAccount } from "@/auth/auth";
import { AuthedShell } from "@/components/layout/authed-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SignatureForm } from "@/components/campaign/signature-form";
import { SmtpForm } from "@/components/campaign/smtp-form";
import { getSignature } from "@/services/signature-service";
import { getSmtpConfig } from "@/services/smtp-service";

export default async function SettingsPage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/");
  }

  const [account, signature, smtpConfig] = await Promise.all([
    getDecryptedGoogleAccount(session.user.id),
    getSignature(session.user.id),
    getSmtpConfig(session.user.id),
  ]);

  return (
    <AuthedShell>
      <h1 className="mb-6 text-lg font-semibold text-zinc-100">Settings</h1>
      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Gmail Connection</CardTitle>
            <CardDescription>
              Used to send campaigns, unless a custom SMTP account is configured below.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {account ? (
              <Badge variant="success">Connected as {session.user.email}</Badge>
            ) : (
              <Badge variant="destructive">Not connected — please reconnect Gmail</Badge>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Custom SMTP (Webmail)</CardTitle>
            <CardDescription>
              Send from your own domain email (cPanel, Zoho Mail, Titan, etc.) instead of Gmail.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <SmtpForm
              initialValue={
                smtpConfig
                  ? {
                      host: smtpConfig.host,
                      port: smtpConfig.port,
                      secure: smtpConfig.secure,
                      username: smtpConfig.username,
                      fromEmail: smtpConfig.fromEmail,
                    }
                  : null
              }
            />
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
