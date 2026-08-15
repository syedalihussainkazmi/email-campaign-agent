import { redirect } from "next/navigation";
import { auth } from "@/auth/session";
import { AuthedShell } from "@/components/layout/authed-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { RolloutPlannerPanel } from "@/components/campaign/rollout-planner-panel";
import { CapacityTimelinePanel } from "@/components/campaign/capacity-timeline-panel";

export default async function CalculatorPage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/");
  }

  return (
    <AuthedShell>
      <h1 className="mb-6 text-lg font-semibold text-zinc-100">Calculator</h1>
      <div className="flex flex-col gap-6">
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
      </div>
    </AuthedShell>
  );
}
