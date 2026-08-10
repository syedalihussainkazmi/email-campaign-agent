import { redirect } from "next/navigation";
import { auth } from "@/auth/session";
import { AuthedShell } from "@/components/layout/authed-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { SignatureForm } from "@/components/campaign/signature-form";
import { SmtpForm } from "@/components/campaign/smtp-form";
import { getSignature } from "@/services/signature-service";
import { getSmtpConfig } from "@/services/smtp-service";

export default async function SettingsPage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/");
  }

  const [signature, smtpConfig] = await Promise.all([
    getSignature(session.user.id),
    getSmtpConfig(session.user.id),
  ]);

  return (
    <AuthedShell>
      <h1 className="mb-6 text-lg font-semibold text-zinc-100">Settings</h1>
      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Webmail (SMTP)</CardTitle>
            <CardDescription>
              The account campaigns send from — your own domain email (cPanel, Zoho Mail, Titan, etc.).
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
