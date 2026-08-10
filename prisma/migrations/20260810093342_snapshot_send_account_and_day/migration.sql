-- AlterTable
ALTER TABLE "CampaignRecipient" ADD COLUMN     "scheduledFor" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "smtpAccountId" TEXT;

-- AddForeignKey
ALTER TABLE "CampaignRecipient" ADD CONSTRAINT "CampaignRecipient_smtpAccountId_fkey" FOREIGN KEY ("smtpAccountId") REFERENCES "SmtpAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
