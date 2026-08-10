import { auth, signIn } from "@/auth/auth";
import { AuthedShell } from "@/components/layout/authed-shell";
import { CampaignCard } from "@/components/campaign/campaign-card";
import { Button } from "@/components/ui/button";
import { devSignInAction } from "@/actions/dev-auth-actions";
import { isDevLoginEnabled } from "@/utils/dev-login";
import { WebmailSignInForm } from "@/components/auth/webmail-signin-form";
import { LogoMark } from "@/components/brand/logo";

export default async function HomePage() {
  const session = await auth();

  if (!session?.user) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-zinc-950 text-center">
        <div className="flex flex-col items-center gap-3">
          <LogoMark className="h-12 w-12" />
          <h1 className="text-2xl font-extrabold tracking-tight">
            <span className="text-zinc-100">Mail</span>
            <span className="text-red-500">Pilot</span>
          </h1>
          <p className="text-sm text-zinc-400">
            AI-assisted email campaigns, sent from your own Gmail account.
          </p>
          <p className="text-[11px] font-semibold uppercase tracking-widest text-zinc-600">
            by DevXtech <span className="text-red-500">&middot;</span> devxtech.com
          </p>
        </div>
        <div className="flex flex-wrap items-start justify-center gap-3">
          <form
            action={async () => {
              "use server";
              await signIn("google");
            }}
          >
            <Button type="submit" size="lg">
              Connect Gmail
            </Button>
          </form>

          <WebmailSignInForm />
        </div>

        {isDevLoginEnabled() && (
          <form action={devSignInAction}>
            <Button type="submit" size="sm" variant="ghost">
              Preview as Test User (dev only, no Gmail needed)
            </Button>
          </form>
        )}
      </div>
    );
  }

  return (
    <AuthedShell>
      <CampaignCard />
    </AuthedShell>
  );
}
