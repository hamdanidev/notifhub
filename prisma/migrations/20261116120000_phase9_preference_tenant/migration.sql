-- Preference center: tenant scoping for notification preferences.
-- recipientId is the consumer's externalId and is therefore only unique inside a tenant,
-- so the uniqueness constraint must include tenantId. Existing rows carry no tenant
-- information and inherit the default tenant (documented in docs/phase-9-design.md).

ALTER TABLE "NotificationPreference" ADD COLUMN "tenantId" TEXT NOT NULL DEFAULT 'default';

DROP INDEX "NotificationPreference_recipientId_channel_key";

CREATE UNIQUE INDEX "NotificationPreference_tenantId_recipientId_channel_key"
  ON "NotificationPreference"("tenantId", "recipientId", "channel");
