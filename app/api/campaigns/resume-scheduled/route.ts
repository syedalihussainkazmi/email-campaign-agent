import { NextResponse } from "next/server";
import { prisma } from "@/database/prisma";
import { startCampaignRunner, isRunnerActive } from "@/server/campaign-runner";

/**
 * Finds any campaign whose next scheduled recipient batch has come due but
 * isn't actually being driven by an in-process runner right now, and
 * (re)starts it. Two distinct cases land here:
 *
 * 1. "paused" — the normal multi-day flow (Task 9): a campaign pauses
 *    itself between days and waits for this trigger to resume.
 * 2. "running" with no active in-process runner — an orphaned campaign.
 *    The runner is an in-memory loop (see server/campaign-runner.ts); if
 *    the Node process restarts (dev server reload, deploy, crash) while a
 *    campaign is mid-send, its DB row is still "running" but nothing is
 *    actually driving it anymore. Without this check it would stay stuck
 *    at 0 progress forever.
 *
 * Needs an external trigger to actually run on a schedule — visiting this
 * route periodically (a cron ping, a Routine, or just opening the app) is
 * what catches both cases instead of leaving them stuck until someone
 * notices.
 */
export async function GET() {
  const candidates = await prisma.campaign.findMany({
    where: {
      status: { in: ["paused", "running"] },
      recipients: { some: { status: "pending", scheduledFor: { lte: new Date() } } },
    },
    select: { id: true, status: true },
  });

  const toResume = candidates.filter((c) => c.status === "paused" || !isRunnerActive(c.id));

  for (const campaign of toResume) {
    void startCampaignRunner(campaign.id);
  }

  return NextResponse.json({ resumed: toResume.length });
}
