-- AlterTable
ALTER TABLE "Recipient" ADD COLUMN     "unsubscribeToken" TEXT NOT NULL,
ADD COLUMN     "unsubscribedAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "Recipient_unsubscribeToken_key" ON "Recipient"("unsubscribeToken");

