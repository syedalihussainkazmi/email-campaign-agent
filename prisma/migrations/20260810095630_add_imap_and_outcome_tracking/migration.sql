/*
  Warnings:

  - You are about to drop the column `googleAccountEmail` on the `Campaign` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Campaign" DROP COLUMN "googleAccountEmail",
ADD COLUMN     "bouncedCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "repliedCount" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "CampaignRecipient" ADD COLUMN     "bounceReason" TEXT,
ADD COLUMN     "bouncedAt" TIMESTAMP(3),
ADD COLUMN     "repliedAt" TIMESTAMP(3),
ADD COLUMN     "sentMessageId" TEXT;

-- AlterTable
ALTER TABLE "SmtpAccount" ADD COLUMN     "imapHost" TEXT,
ADD COLUMN     "imapPort" INTEGER NOT NULL DEFAULT 993,
ADD COLUMN     "imapSecure" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "lastInboxCheckAt" TIMESTAMP(3);
