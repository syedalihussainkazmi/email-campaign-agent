-- AlterTable
ALTER TABLE "CampaignRecipient" ADD COLUMN     "openCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "openedAt" TIMESTAMP(3);

