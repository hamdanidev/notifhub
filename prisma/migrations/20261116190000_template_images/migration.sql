-- CreateTable
CREATE TABLE "TemplateImage" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT 'default',
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "checksum" TEXT NOT NULL,
    "createdByAdminId" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TemplateImage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TemplateImage_storageKey_key" ON "TemplateImage"("storageKey");

-- CreateIndex
CREATE INDEX "TemplateImage_tenantId_createdAt_idx" ON "TemplateImage"("tenantId", "createdAt");
