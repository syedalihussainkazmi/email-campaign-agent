import { NextResponse } from "next/server";
import { prisma } from "@/database/prisma";
import { startCampaignRunner } from "@/server/campaign-runner";

/**
 * Finds any paused campaign whose next scheduled recipient batch has come
 * due and resumes it. Needs an external trigger to actually run on a
 * schedule — visiting this route once a day (a cron ping, a Routine, or
 * just opening the app) is what makes multi-day campaigns finish on their
 * own instead of staying paused until someone notices.
 */
export async function GET() {
  const due = await prisma.campaign.findMany({
    where: {
      status: "paused",
      recipients: { some: { status: "pending", scheduledFor: { lte: new Date() } } },
    },
    select: { id: true },
  });

  for (const campaign of due) {
    void startCampaignRunner(campaign.id);
  }

  return NextResponse.json({ resumed: due.length });
}
