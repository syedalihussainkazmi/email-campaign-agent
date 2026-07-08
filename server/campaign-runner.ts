import { prisma } from "@/database/prisma";
import { getEmailSender } from "@/services/email-sender";
import { randomDelaySeconds, sleep } from "@/utils/delay";

const activeRunners = new Set<string>();

/**
 * Drives a campaign's send loop: one recipient at a time, with a random
 * 5-10s delay between sends to avoid tripping Gmail's spam/rate defenses.
 * Progress is written to the DB after every send so a page refresh (or
 * process restart) can resume from persisted state rather than memory.
 * Runs in-process; for multi-instance scale this is the seam to swap in
 * a real job queue (BullMQ/Redis) without touching the rest of the app.
 */
export async function startCampaignRunner(campaignId: string) {
  if (activeRunners.has(campaignId)) return;
  activeRunners.add(campaignId);

  try {
    await prisma.campaign.update({
      where: { id: campaignId },
      data: { status: "running", startedAt: new Date(), controlFlag: "none" },
    });

    const sender = getEmailSender();
    const campaign = await prisma.campaign.findUniqueOrThrow({ where: { id: campaignId } });

    while (true) {
      const fresh = await prisma.campaign.findUniqueOrThrow({ where: { id: campaignId } });

      if (fresh.controlFlag === "cancel") {
        await prisma.campaign.update({
          where: { id: campaignId },
          data: { status: "failed", completedAt: new Date() },
        });
        return;
      }

      if (fresh.controlFlag === "pause") {
        await prisma.campaign.update({ where: { id: campaignId }, data: { status: "paused" } });
        return;
      }

      const next = await prisma.campaignRecipient.findFirst({
        where: { campaignId, status: "pending" },
        include: { recipient: true },
        orderBy: { id: "asc" },
      });

      if (!next) {
        await prisma.campaign.update({
          where: { id: campaignId },
          data: { status: "completed", completedAt: new Date() },
        });
        return;
      }

      await prisma.campaignRecipient.update({
        where: { id: next.id },
        data: { status: "sending" },
      });

      const result = await sender.send(campaign.userId, {
        to: next.recipient.email,
        subject: campaign.subject,
        bodyHtml: campaign.bodyHtml,
        bodyText: campaign.bodyText ?? undefined,
      });

      await prisma.$transaction([
        prisma.campaignRecipient.update({
          where: { id: next.id },
          data: {
            status: result.success ? "sent" : "failed",
            sentAt: new Date(),
            error: result.error,
          },
        }),
        prisma.campaign.update({
          where: { id: campaignId },
          data: {
            sentCount: { increment: 1 },
            deliveredCount: result.success ? { increment: 1 } : undefined,
            failedCount: result.success ? undefined : { increment: 1 },
          },
        }),
      ]);

      const delaySeconds = randomDelaySeconds(5, 10);
      await prisma.campaign.update({
        where: { id: campaignId },
        data: { avgIntervalSeconds: delaySeconds },
      });
      await sleep(delaySeconds * 1000);
    }
  } finally {
    activeRunners.delete(campaignId);
  }
}

export function isRunnerActive(campaignId: string): boolean {
  return activeRunners.has(campaignId);
}
