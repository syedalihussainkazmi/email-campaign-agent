import { auth, signIn } from "@/auth/auth";
import { AuthedShell } from "@/components/layout/authed-shell";
import { CampaignCard } from "@/components/campaign/campaign-card";
import { Button } from "@/components/ui/button";

export default async function HomePage() {
  const session = await auth();

  if (!session?.user) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-zinc-950 text-center">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-100">MailPilot</h1>
          <p className="mt-2 text-sm text-zinc-400">
            AI-assisted email campaigns, sent from your own Gmail account.
          </p>
        </div>
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
      </div>
    );
  }

  return (
    <AuthedShell>
      <CampaignCard />
    </AuthedShell>
  );
}
