-- CreateEnum
CREATE TYPE "TenantStatus" AS ENUM ('active', 'suspended');

-- DropIndex
DROP INDEX "Notification_idempotencyKey_key";

-- AlterTable
ALTER TABLE "AdminUser" ALTER COLUMN "tenantId" DROP NOT NULL,
ALTER COLUMN "tenantId" DROP DEFAULT;

-- CreateTable
CREATE TABLE "Tenant" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "TenantStatus" NOT NULL DEFAULT 'active',
    "suspendedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Tenant_status_idx" ON "Tenant"("status");

-- CreateIndex
CREATE INDEX "Tenant_createdAt_idx" ON "Tenant"("createdAt");

-- CreateIndex
CREATE INDEX "AdminUser_role_idx" ON "AdminUser"("role");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_tenantId_idempotencyKey_key" ON "Notification"("tenantId", "idempotencyKey");

-- Backfill: every existing tenantId must have a Tenant row before the foreign keys are added.
INSERT INTO "Tenant" ("id", "name", "status", "createdAt", "updatedAt")
SELECT DISTINCT t."tenantId", t."tenantId", 'active'::"TenantStatus", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM (
  SELECT "tenantId" FROM "Notification"
  UNION SELECT "tenantId" FROM "NotificationTemplate"
  UNION SELECT "tenantId" FROM "TemplateLayout"
  UNION SELECT "tenantId" FROM "TemplateTheme"
  UNION SELECT "tenantId" FROM "TemplatePartial"
  UNION SELECT "tenantId" FROM "TemplateAuditEvent"
  UNION SELECT "tenantId" FROM "TemplateTestSend"
  UNION SELECT "tenantId" FROM "TemplateImage"
  UNION SELECT "tenantId" FROM "NotificationPreference"
  UNION SELECT "tenantId" FROM "BillingEvent"
  UNION SELECT "tenantId" FROM "Subscriber"
  UNION SELECT "tenantId" FROM "Topic"
  UNION SELECT "tenantId" FROM "ApiKey"
  UNION SELECT "tenantId" FROM "AdminUser" WHERE "tenantId" IS NOT NULL
) AS t
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "Tenant" ("id", "name", "status", "createdAt", "updatedAt")
VALUES ('default', 'Default', 'active'::"TenantStatus", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationTemplate" ADD CONSTRAINT "NotificationTemplate_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemplateLayout" ADD CONSTRAINT "TemplateLayout_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemplateTheme" ADD CONSTRAINT "TemplateTheme_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemplatePartial" ADD CONSTRAINT "TemplatePartial_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemplateAuditEvent" ADD CONSTRAINT "TemplateAuditEvent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemplateTestSend" ADD CONSTRAINT "TemplateTestSend_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemplateImage" ADD CONSTRAINT "TemplateImage_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingEvent" ADD CONSTRAINT "BillingEvent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscriber" ADD CONSTRAINT "Subscriber_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Topic" ADD CONSTRAINT "Topic_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminUser" ADD CONSTRAINT "AdminUser_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Platform admins have no tenant; tenant admins must always belong to one.
ALTER TABLE "AdminUser"
  ADD CONSTRAINT "AdminUser_role_tenant_check"
  CHECK (
    ("role" = 'platform_admin' AND "tenantId" IS NULL) OR
    ("role" = 'tenant_admin' AND "tenantId" IS NOT NULL)
  );

