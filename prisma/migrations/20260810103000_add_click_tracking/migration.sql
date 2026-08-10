-- AlterTable
ALTER TABLE "CampaignRecipient" ADD COLUMN     "clickCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "firstClickedAt" TIMESTAMP(3),
ADD COLUMN     "trackingId" TEXT;

-- Backfill existing rows with a unique value before the column is made required.
UPDATE "CampaignRecipient" SET "trackingId" = md5(random()::text || clock_timestamp()::text || id)
WHERE "trackingId" IS NULL;

ALTER TABLE "CampaignRecipient" ALTER COLUMN "trackingId" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "CampaignRecipient_trackingId_key" ON "CampaignRecipient"("trackingId");

