-- CreateEnum
CREATE TYPE "TemplateApprovalMode" AS ENUM ('two_person', 'self_approval_allowed');

-- CreateEnum
CREATE TYPE "TemplateApprovalStatus" AS ENUM ('pending', 'approved', 'rejected');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "TemplateAuditAction" ADD VALUE 'submitted_for_review';
ALTER TYPE "TemplateAuditAction" ADD VALUE 'approved';
ALTER TYPE "TemplateAuditAction" ADD VALUE 'rejected';
ALTER TYPE "TemplateAuditAction" ADD VALUE 'approval_reopened';

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "templateApprovalMode" "TemplateApprovalMode" NOT NULL DEFAULT 'two_person';

-- CreateTable
CREATE TABLE "TemplateApproval" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT 'default',
    "templateId" TEXT NOT NULL,
    "templateVersion" INTEGER NOT NULL,
    "revision" INTEGER NOT NULL,
    "status" "TemplateApprovalStatus" NOT NULL DEFAULT 'pending',
    "requestedByAdminId" TEXT NOT NULL,
    "requestedByEmail" TEXT NOT NULL,
    "requestedNote" TEXT,
    "reviewedByAdminId" TEXT,
    "reviewedByEmail" TEXT,
    "reviewNote" TEXT,
    "selfApproved" BOOLEAN NOT NULL DEFAULT false,
    "selfApprovalReason" TEXT,
    "requestedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "TemplateApproval_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TemplateApproval_tenantId_status_requestedAt_idx" ON "TemplateApproval"("tenantId", "status", "requestedAt");

-- CreateIndex
CREATE INDEX "TemplateApproval_tenantId_templateId_createdAt_idx" ON "TemplateApproval"("tenantId", "templateId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "TemplateApproval_templateId_revision_key" ON "TemplateApproval"("templateId", "revision");

-- AddForeignKey
ALTER TABLE "TemplateApproval" ADD CONSTRAINT "TemplateApproval_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemplateApproval" ADD CONSTRAINT "TemplateApproval_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "NotificationTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

