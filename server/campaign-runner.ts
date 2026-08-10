import { prisma } from "@/database/prisma";
import { getEmailSenderForAccount } from "@/services/email-sender";
import { incrementSentToday } from "@/services/smtp-service";
import { getSignature } from "@/services/signature-service";
import { randomDelaySeconds, sleep } from "@/utils/delay";
import { renderTemplate } from "@/utils/template";
import { looksLikeHtml, stripHtml } from "@/utils/html";
import { rewriteLinksForTracking } from "@/utils/link-tracking";
import { buildUnsubscribeHeaders } from "@/services/unsubscribe-service";

const activeRunners = new Set<string>();

/**
 * Drives a campaign's send loop: one recipient at a time, with a random
 * 5-10s delay between sends to avoid tripping spam/rate defenses. Progress
 * is written to the DB after every send so a page refresh (or process
 * restart) can resume from persisted state rather than memory. Runs
 * in-process; for multi-instance scale this is the seam to swap in a real
 * job queue (BullMQ/Redis) without touching the rest of the app.
 *
 * Recipients may be assigned to different SmtpAccounts and different send
 * days (Task 7), so the sender is resolved per-recipient rather than once
 * for the whole campaign, and the loop only processes recipients whose
 * scheduledFor has arrived — anything further out just pauses the campaign
 * until the next external trigger (see app/api/campaigns/resume-scheduled).
 */
export async function startCampaignRunner(campaignId: string) {
  if (activeRunners.has(campaignId)) return;
  activeRunners.add(campaignId);

  try {
    await prisma.campaign.update({
      where: { id: campaignId },
      data: { status: "running", startedAt: new Date(), controlFlag: "none" },
    });

    const campaign = await prisma.campaign.findUniqueOrThrow({ where: { id: campaignId } });
    const signature = await getSignature(campaign.userId);
    const signatureIsHtml = looksLikeHtml(signature);
    const signatureHtml = signature
      ? `<br/><br/>${signatureIsHtml ? signature : signature.replace(/\n/g, "<br/>")}`
      : "";
    const signatureText = signature ? `\n\n${signatureIsHtml ? stripHtml(signature) : signature}` : "";

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
        where: {
          campaignId,
          status: "pending",
          scheduledFor: { lte: new Date() },
        },
        orderBy: { id: "asc" },
      });

      if (!next) {
        // Either fully done, or everything remaining is scheduled for a future day.
        const anyFuture = await prisma.campaignRecipient.findFirst({
          where: { campaignId, status: "pending" },
        });
        await prisma.campaign.update({
          where: { id: campaignId },
          data: anyFuture
            ? { status: "paused" } // resumes automatically next time the runner is (re)started for this campaign
            : { status: "completed", completedAt: new Date() },
        });
        return;
      }

      await prisma.campaignRecipient.update({ where: { id: next.id }, data: { status: "sending" } });

      if (!next.smtpAccountId) {
        await prisma.campaignRecipient.update({
          where: { id: next.id },
          data: { status: "failed", error: "No SMTP account assigned to this recipient" },
        });
        continue;
      }

      const recipient = await prisma.recipient.findUniqueOrThrow({ where: { id: next.recipientId } });

      if (recipient.unsubscribedAt) {
        await prisma.campaignRecipient.update({
          where: { id: next.id },
          data: { status: "failed", error: "Recipient unsubscribed" },
        });
        continue;
      }

      const sender = await getEmailSenderForAccount(next.smtpAccountId, campaign.userId);
      const variables = { businessName: next.name, ownerName: next.ownerName };

      const renderedHtml = renderTemplate(campaign.bodyHtml, variables) + signatureHtml;
      const trackedHtml = process.env.APP_BASE_URL
        ? rewriteLinksForTracking(renderedHtml, next.trackingId, process.env.APP_BASE_URL)
        : renderedHtml;

      const unsubscribeUrl = `${process.env.APP_BASE_URL}/api/unsubscribe/${recipient.unsubscribeToken}`;
      const unsubscribeFooter =
        `<br/><br/><p style="font-size:11px;color:#888">Don't want these emails? ` +
        `<a href="${unsubscribeUrl}">Unsubscribe</a></p>`;

      const result = await sender.send(campaign.userId, {
        to: recipient.email,
        subject: renderTemplate(campaign.subject, variables),
        bodyHtml: trackedHtml + unsubscribeFooter,
        bodyText: campaign.bodyText
          ? renderTemplate(campaign.bodyText, variables) + signatureText + `\n\nUnsubscribe: ${unsubscribeUrl}`
          : undefined,
        headers: buildUnsubscribeHeaders(unsubscribeUrl),
      });

      if (result.success) {
        await incrementSentToday(next.smtpAccountId);
      }

      await prisma.$transaction([
        prisma.campaignRecipient.update({
          where: { id: next.id },
          data: {
            status: result.success ? "sent" : "failed",
            sentAt: new Date(),
            error: result.error,
            sentMessageId: result.messageId,
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
