-- AlterTable
ALTER TABLE "Recipient" ADD COLUMN     "unsubscribeToken" TEXT,
ADD COLUMN     "unsubscribedAt" TIMESTAMP(3);

-- Backfill existing rows with a unique value before the column is made required.
UPDATE "Recipient" SET "unsubscribeToken" = md5(random()::text || clock_timestamp()::text || id)
WHERE "unsubscribeToken" IS NULL;

ALTER TABLE "Recipient" ALTER COLUMN "unsubscribeToken" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Recipient_unsubscribeToken_key" ON "Recipient"("unsubscribeToken");

