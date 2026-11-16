-- Template system v2: versioned drafts, channel formats, assets, audit and test sends.
-- Additive migration: existing template rows remain published and render through the legacy
-- body-only path until an admin creates a new draft/version.

CREATE TYPE "TemplateStatus" AS ENUM ('draft', 'published');
CREATE TYPE "TemplateFormat" AS ENUM ('text', 'html', 'markdown');
CREATE TYPE "TemplateDirection" AS ENUM ('auto', 'ltr', 'rtl');
CREATE TYPE "TemplateAuditAction" AS ENUM (
  'created',
  'draft_updated',
  'updated',
  'published',
  'deactivated',
  'activated',
  'cloned',
  'rolled_back',
  'test_sent'
);

ALTER TABLE "NotificationTemplate"
  ADD COLUMN "preheader" TEXT,
  ADD COLUMN "format" "TemplateFormat" NOT NULL DEFAULT 'text',
  ADD COLUMN "direction" "TemplateDirection" NOT NULL DEFAULT 'auto',
  ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "status" "TemplateStatus" NOT NULL DEFAULT 'published',
  ADD COLUMN "strictVariables" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "variables" JSONB,
  ADD COLUMN "sampleData" JSONB,
  ADD COLUMN "layoutId" TEXT,
  ADD COLUMN "themeId" TEXT,
  ADD COLUMN "publishedAt" TIMESTAMPTZ(6),
  ADD COLUMN "publishedByAdminId" TEXT;

-- Legacy email bodies are already HTML fragments/documents.
UPDATE "NotificationTemplate"
SET "format" = 'html'
WHERE "channel" = 'email';

-- Existing active rows are treated as already published at their last update time.
UPDATE "NotificationTemplate"
SET "publishedAt" = "updatedAt"
WHERE "status" = 'published' AND "publishedAt" IS NULL;

CREATE TABLE "TemplateLayout" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL DEFAULT 'default',
  "key" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "name" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "createdByAdminId" TEXT,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "TemplateLayout_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TemplateTheme" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL DEFAULT 'default',
  "key" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "name" TEXT NOT NULL,
  "tokens" JSONB NOT NULL,
  "createdByAdminId" TEXT,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "TemplateTheme_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TemplatePartial" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL DEFAULT 'default',
  "key" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "name" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "createdByAdminId" TEXT,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "TemplatePartial_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TemplatePartialLink" (
  "templateId" TEXT NOT NULL,
  "partialId" TEXT NOT NULL,

  CONSTRAINT "TemplatePartialLink_pkey" PRIMARY KEY ("templateId", "partialId")
);

CREATE TABLE "TemplateAuditEvent" (
  "id" BIGSERIAL NOT NULL,
  "tenantId" TEXT NOT NULL DEFAULT 'default',
  "templateId" TEXT NOT NULL,
  "templateVersion" INTEGER NOT NULL,
  "action" "TemplateAuditAction" NOT NULL,
  "actorAdminId" TEXT,
  "actorEmail" TEXT,
  "note" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "TemplateAuditEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TemplateTestSend" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL DEFAULT 'default',
  "templateId" TEXT NOT NULL,
  "templateVersion" INTEGER NOT NULL,
  "channel" "Channel" NOT NULL,
  "recipientMasked" TEXT NOT NULL,
  "recipientHash" TEXT NOT NULL,
  "requestKey" TEXT,
  "status" TEXT NOT NULL,
  "providerName" TEXT,
  "providerMessageId" TEXT,
  "errorCode" TEXT,
  "errorMessage" TEXT,
  "requestedByAdminId" TEXT,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "TemplateTestSend_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TemplateLayout_tenantId_key_version_key"
  ON "TemplateLayout"("tenantId", "key", "version");
CREATE INDEX "TemplateLayout_tenantId_key_version_idx"
  ON "TemplateLayout"("tenantId", "key", "version");

CREATE UNIQUE INDEX "TemplateTheme_tenantId_key_version_key"
  ON "TemplateTheme"("tenantId", "key", "version");
CREATE INDEX "TemplateTheme_tenantId_key_version_idx"
  ON "TemplateTheme"("tenantId", "key", "version");

CREATE UNIQUE INDEX "TemplatePartial_tenantId_key_version_key"
  ON "TemplatePartial"("tenantId", "key", "version");
CREATE INDEX "TemplatePartial_tenantId_key_version_idx"
  ON "TemplatePartial"("tenantId", "key", "version");

CREATE INDEX "TemplatePartialLink_partialId_idx"
  ON "TemplatePartialLink"("partialId");

CREATE INDEX "TemplateAuditEvent_tenantId_templateId_createdAt_idx"
  ON "TemplateAuditEvent"("tenantId", "templateId", "createdAt");
CREATE INDEX "TemplateAuditEvent_tenantId_createdAt_idx"
  ON "TemplateAuditEvent"("tenantId", "createdAt");

CREATE UNIQUE INDEX "TemplateTestSend_tenantId_requestKey_key"
  ON "TemplateTestSend"("tenantId", "requestKey");
CREATE INDEX "TemplateTestSend_tenantId_createdAt_idx"
  ON "TemplateTestSend"("tenantId", "createdAt");
CREATE INDEX "TemplateTestSend_templateId_createdAt_idx"
  ON "TemplateTestSend"("templateId", "createdAt");
CREATE INDEX "TemplateTestSend_requestedByAdminId_createdAt_idx"
  ON "TemplateTestSend"("requestedByAdminId", "createdAt");

CREATE INDEX "NotificationTemplate_tenantId_key_channel_locale_active_status_idx"
  ON "NotificationTemplate"("tenantId", "key", "channel", "locale", "active", "status");
CREATE INDEX "NotificationTemplate_tenantId_status_updatedAt_idx"
  ON "NotificationTemplate"("tenantId", "status", "updatedAt");
CREATE INDEX "NotificationTemplate_layoutId_idx"
  ON "NotificationTemplate"("layoutId");
CREATE INDEX "NotificationTemplate_themeId_idx"
  ON "NotificationTemplate"("themeId");

ALTER TABLE "NotificationTemplate"
  ADD CONSTRAINT "NotificationTemplate_layoutId_fkey"
  FOREIGN KEY ("layoutId") REFERENCES "TemplateLayout"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "NotificationTemplate"
  ADD CONSTRAINT "NotificationTemplate_themeId_fkey"
  FOREIGN KEY ("themeId") REFERENCES "TemplateTheme"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "TemplatePartialLink"
  ADD CONSTRAINT "TemplatePartialLink_templateId_fkey"
  FOREIGN KEY ("templateId") REFERENCES "NotificationTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TemplatePartialLink"
  ADD CONSTRAINT "TemplatePartialLink_partialId_fkey"
  FOREIGN KEY ("partialId") REFERENCES "TemplatePartial"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TemplateAuditEvent"
  ADD CONSTRAINT "TemplateAuditEvent_templateId_fkey"
  FOREIGN KEY ("templateId") REFERENCES "NotificationTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TemplateTestSend"
  ADD CONSTRAINT "TemplateTestSend_templateId_fkey"
  FOREIGN KEY ("templateId") REFERENCES "NotificationTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Drop the old narrower index now replaced by the active/status index.
DROP INDEX IF EXISTS "NotificationTemplate_tenantId_key_channel_locale_active_idx";
