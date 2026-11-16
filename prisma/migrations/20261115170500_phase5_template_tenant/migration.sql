-- Phase 5: tenant scoping for notification templates.
-- Templates are managed per tenant by the admin API, so lookups and the uniqueness
-- constraint become tenant-scoped. Existing rows inherit the default tenant.

ALTER TABLE "NotificationTemplate" ADD COLUMN "tenantId" TEXT NOT NULL DEFAULT 'default';

DROP INDEX "NotificationTemplate_key_channel_locale_active_idx";
DROP INDEX "NotificationTemplate_key_channel_locale_version_key";

CREATE UNIQUE INDEX "NotificationTemplate_tenantId_key_channel_locale_version_key"
  ON "NotificationTemplate"("tenantId", "key", "channel", "locale", "version");

CREATE INDEX "NotificationTemplate_tenantId_key_channel_locale_active_idx"
  ON "NotificationTemplate"("tenantId", "key", "channel", "locale", "active");
