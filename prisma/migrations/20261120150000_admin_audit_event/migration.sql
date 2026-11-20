-- Audit aksi admin tenant; append-only, tenant-scoped, tanpa FK.
CREATE TABLE "AdminAuditEvent" (
    "id" BIGSERIAL NOT NULL,
    "tenantId" TEXT NOT NULL,
    "actorAdminId" TEXT NOT NULL,
    "actorEmail" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "metadata" JSONB,
    "ip" TEXT,
    "requestId" TEXT,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminAuditEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AdminAuditEvent_tenantId_occurredAt_idx" ON "AdminAuditEvent"("tenantId", "occurredAt");
CREATE INDEX "AdminAuditEvent_tenantId_action_occurredAt_idx" ON "AdminAuditEvent"("tenantId", "action", "occurredAt");
CREATE INDEX "AdminAuditEvent_actorAdminId_occurredAt_idx" ON "AdminAuditEvent"("actorAdminId", "occurredAt");
