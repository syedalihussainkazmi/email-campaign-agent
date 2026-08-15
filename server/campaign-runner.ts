import { prisma } from "@/database/prisma";
import { getEmailSenderForAccount } from "@/services/email-sender";
import { incrementSentToday } from "@/services/smtp-service";
import { getSignature } from "@/services/signature-service";
import { randomDelaySeconds, sleep } from "@/utils/delay";
import { renderTemplate } from "@/utils/template";
import { looksLikeHtml, stripHtml } from "@/utils/html";
import { rewriteLinksForTracking, openTrackingPixel } from "@/utils/link-tracking";
import { buildUnsubscribeHeaders } from "@/services/unsubscribe-service";
import { getSendingWindow, isWithinSendingWindow } from "@/services/sending-window-service";

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
    // Deliberately doesn't touch controlFlag here: a pending "cancel"/"pause"
    // set while this campaign had no active runner (e.g. it was orphaned by
    // a process restart, then picked back up by resume-scheduled) must
    // survive into the loop below, whose very first check handles it. The
    // "none" case is already the DB default for brand-new campaigns, and
    // setCampaignControlAction's explicit Resume path already writes "none"
    // itself before calling this function — resetting it here again would
    // only risk clobbering a real pending flag with a race.
    await prisma.campaign.update({
      where: { id: campaignId },
      data: { status: "running", startedAt: new Date() },
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

      const window = await getSendingWindow(campaign.userId);
      if (!isWithinSendingWindow(new Date(), window)) {
        await prisma.campaign.update({ where: { id: campaignId }, data: { status: "paused" } });
        return; // picked back up by the same daily/periodic trigger as Task 9's multi-day resume
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

      // Unsubscribe link/header, click-tracking, and the open pixel all require a
      // real publicly-reachable APP_BASE_URL — without one, none of them are
      // included rather than shipping a broken "undefined/..." URL in every email.
      const unsubscribeUrl = process.env.APP_BASE_URL
        ? `${process.env.APP_BASE_URL}/api/unsubscribe/${recipient.unsubscribeToken}`
        : null;
      const unsubscribeFooter = unsubscribeUrl
        ? `<br/><br/><p style="font-size:11px;color:#888">Don't want these emails? ` +
          `<a href="${unsubscribeUrl}">Unsubscribe</a></p>`
        : "";
      const pixel = process.env.APP_BASE_URL
        ? openTrackingPixel(next.trackingId, process.env.APP_BASE_URL)
        : "";

      const result = await sender.send(campaign.userId, {
        to: recipient.email,
        subject: renderTemplate(campaign.subject, variables),
        bodyHtml: trackedHtml + unsubscribeFooter + pixel,
        bodyText: campaign.bodyText
          ? renderTemplate(campaign.bodyText, variables) +
            signatureText +
            (unsubscribeUrl ? `\n\nUnsubscribe: ${unsubscribeUrl}` : "")
          : undefined,
        headers: unsubscribeUrl ? buildUnsubscribeHeaders(unsubscribeUrl) : undefined,
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

      const delaySeconds = campaign.fixedDelaySeconds ?? randomDelaySeconds(5, 10);
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
