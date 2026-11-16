-- AlterTable
ALTER TABLE "NotificationRecipient" ADD COLUMN     "templateId" TEXT,
ADD COLUMN     "templateResolvedAt" TIMESTAMPTZ,
ADD COLUMN     "templateVersion" INTEGER;

-- CreateIndex
CREATE INDEX "NotificationRecipient_templateId_idx" ON "NotificationRecipient"("templateId");
