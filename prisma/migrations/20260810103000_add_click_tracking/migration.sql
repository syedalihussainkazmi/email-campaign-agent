-- AlterTable
ALTER TABLE "CampaignRecipient" ADD COLUMN     "clickCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "firstClickedAt" TIMESTAMP(3),
ADD COLUMN     "trackingId" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "CampaignRecipient_trackingId_key" ON "CampaignRecipient"("trackingId");

