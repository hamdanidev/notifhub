-- CreateIndex
CREATE INDEX "TemplateAuditEvent_createdAt_idx" ON "TemplateAuditEvent"("createdAt");

-- CreateIndex
CREATE INDEX "TemplateTestSend_createdAt_idx" ON "TemplateTestSend"("createdAt");

-- RenameIndex
ALTER INDEX "NotificationTemplate_tenantId_key_channel_locale_active_status_" RENAME TO "NotificationTemplate_tenantId_key_channel_locale_active_sta_idx";
