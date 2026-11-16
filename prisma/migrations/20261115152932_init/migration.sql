-- CreateEnum
CREATE TYPE "Channel" AS ENUM ('inapp', 'email', 'whatsapp', 'sms');

-- CreateEnum
CREATE TYPE "Status" AS ENUM ('pending', 'sent', 'failed', 'read', 'skipped');

-- CreateEnum
CREATE TYPE "OverallStatus" AS ENUM ('pending', 'partial', 'sent', 'failed');

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "idempotencyExpiresAt" TIMESTAMP(3) NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT 'default',
    "templateKey" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 3,
    "overallStatus" "OverallStatus" NOT NULL DEFAULT 'pending',
    "targetType" TEXT NOT NULL DEFAULT 'recipients',
    "targetSnapshot" JSONB,
    "groupAckRequired" BOOLEAN NOT NULL DEFAULT false,
    "groupAckDeadline" TIMESTAMPTZ,
    "groupAcknowledgedAt" TIMESTAMPTZ,
    "groupAcknowledgedBy" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "deletedAt" TIMESTAMPTZ,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationRecipient" (
    "id" BIGSERIAL NOT NULL,
    "notificationId" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "channel" "Channel" NOT NULL,
    "status" "Status" NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "providerName" TEXT,
    "providerMessageId" TEXT,
    "sentAt" TIMESTAMPTZ,
    "deliveredAt" TIMESTAMPTZ,
    "readAt" TIMESTAMPTZ,
    "acknowledgedAt" TIMESTAMPTZ,

    CONSTRAINT "NotificationRecipient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationTemplate" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "channel" "Channel" NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'id',
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "fallbackProvider" TEXT,
    "fallbackChannel" "Channel",
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "NotificationTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationPreference" (
    "id" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "channel" "Channel" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "quietHoursStart" TEXT,
    "quietHoursEnd" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Jakarta',
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryEvent" (
    "id" BIGSERIAL NOT NULL,
    "notificationId" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "channel" "Channel" NOT NULL,
    "providerName" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "rawPayload" JSONB NOT NULL,
    "occurredAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeliveryEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryAttempt" (
    "id" BIGSERIAL NOT NULL,
    "notificationId" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "channel" "Channel" NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "providerName" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "errorName" TEXT,
    "errorMessage" TEXT,
    "errorStack" TEXT,
    "durationMs" INTEGER NOT NULL,
    "occurredAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeliveryAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingEvent" (
    "id" BIGSERIAL NOT NULL,
    "notificationId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT 'default',
    "eventType" TEXT NOT NULL,
    "occurredAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BillingEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscriber" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT 'default',
    "externalId" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "locale" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Jakarta',
    "metadata" JSONB,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "Subscriber_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Topic" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT 'default',
    "displayName" TEXT,
    "mode" TEXT NOT NULL DEFAULT 'push',
    "isTimeBound" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "Topic_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TopicSubscriber" (
    "id" TEXT NOT NULL,
    "topicId" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "addedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ,

    CONSTRAINT "TopicSubscriber_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiKey" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT 'default',
    "allowedOrigins" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "subscriberJwtSecret" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastUsedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminUser" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'tenant_admin',
    "tenantId" TEXT NOT NULL DEFAULT 'default',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "AdminUser_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Notification_idempotencyKey_key" ON "Notification"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Notification_createdAt_idx" ON "Notification"("createdAt");

-- CreateIndex
CREATE INDEX "Notification_tenantId_createdAt_idx" ON "Notification"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_overallStatus_idx" ON "Notification"("overallStatus");

-- CreateIndex
CREATE INDEX "Notification_idempotencyExpiresAt_idx" ON "Notification"("idempotencyExpiresAt");

-- CreateIndex
CREATE INDEX "Notification_priority_overallStatus_idx" ON "Notification"("priority", "overallStatus");

-- CreateIndex
CREATE INDEX "NotificationRecipient_recipientId_status_idx" ON "NotificationRecipient"("recipientId", "status");

-- CreateIndex
CREATE INDEX "NotificationRecipient_status_idx" ON "NotificationRecipient"("status");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationRecipient_notificationId_recipientId_channel_key" ON "NotificationRecipient"("notificationId", "recipientId", "channel");

-- CreateIndex
CREATE INDEX "NotificationTemplate_key_channel_locale_active_idx" ON "NotificationTemplate"("key", "channel", "locale", "active");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationTemplate_key_channel_locale_version_key" ON "NotificationTemplate"("key", "channel", "locale", "version");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationPreference_recipientId_channel_key" ON "NotificationPreference"("recipientId", "channel");

-- CreateIndex
CREATE INDEX "DeliveryEvent_notificationId_idx" ON "DeliveryEvent"("notificationId");

-- CreateIndex
CREATE INDEX "DeliveryEvent_providerName_occurredAt_idx" ON "DeliveryEvent"("providerName", "occurredAt");

-- CreateIndex
CREATE INDEX "DeliveryAttempt_notificationId_idx" ON "DeliveryAttempt"("notificationId");

-- CreateIndex
CREATE INDEX "DeliveryAttempt_status_occurredAt_idx" ON "DeliveryAttempt"("status", "occurredAt");

-- CreateIndex
CREATE INDEX "DeliveryAttempt_providerName_occurredAt_idx" ON "DeliveryAttempt"("providerName", "occurredAt");

-- CreateIndex
CREATE INDEX "BillingEvent_tenantId_occurredAt_idx" ON "BillingEvent"("tenantId", "occurredAt");

-- CreateIndex
CREATE INDEX "BillingEvent_notificationId_idx" ON "BillingEvent"("notificationId");

-- CreateIndex
CREATE INDEX "Subscriber_tenantId_email_idx" ON "Subscriber"("tenantId", "email");

-- CreateIndex
CREATE INDEX "Subscriber_tenantId_phone_idx" ON "Subscriber"("tenantId", "phone");

-- CreateIndex
CREATE UNIQUE INDEX "Subscriber_tenantId_externalId_key" ON "Subscriber"("tenantId", "externalId");

-- CreateIndex
CREATE INDEX "Topic_tenantId_createdAt_idx" ON "Topic"("tenantId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Topic_tenantId_key_key" ON "Topic"("tenantId", "key");

-- CreateIndex
CREATE INDEX "TopicSubscriber_expiresAt_idx" ON "TopicSubscriber"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "TopicSubscriber_topicId_recipientId_key" ON "TopicSubscriber"("topicId", "recipientId");

-- CreateIndex
CREATE UNIQUE INDEX "ApiKey_keyHash_key" ON "ApiKey"("keyHash");

-- CreateIndex
CREATE INDEX "ApiKey_tenantId_idx" ON "ApiKey"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "AdminUser_email_key" ON "AdminUser"("email");

-- CreateIndex
CREATE INDEX "AdminUser_tenantId_idx" ON "AdminUser"("tenantId");

-- AddForeignKey
ALTER TABLE "NotificationRecipient" ADD CONSTRAINT "NotificationRecipient_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "Notification"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryAttempt" ADD CONSTRAINT "DeliveryAttempt_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "Notification"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingEvent" ADD CONSTRAINT "BillingEvent_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "Notification"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TopicSubscriber" ADD CONSTRAINT "TopicSubscriber_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE CASCADE ON UPDATE CASCADE;
