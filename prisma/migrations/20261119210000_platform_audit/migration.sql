-- CreateTable
CREATE TABLE "PlatformAuditEvent" (
    "id" BIGSERIAL NOT NULL,
    "actorAdminId" TEXT NOT NULL,
    "actorEmail" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "tenantId" TEXT,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "metadata" JSONB,
    "ip" TEXT,
    "requestId" TEXT,
    "occurredAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformAuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PlatformAuditEvent_tenantId_occurredAt_idx" ON "PlatformAuditEvent"("tenantId", "occurredAt");

-- CreateIndex
CREATE INDEX "PlatformAuditEvent_actorAdminId_occurredAt_idx" ON "PlatformAuditEvent"("actorAdminId", "occurredAt");

-- CreateIndex
CREATE INDEX "PlatformAuditEvent_action_occurredAt_idx" ON "PlatformAuditEvent"("action", "occurredAt");

