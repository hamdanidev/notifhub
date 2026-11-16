-- Audit link for notifications created by an admin resend action.
ALTER TABLE "Notification" ADD COLUMN "resendOfNotificationId" TEXT;
ALTER TABLE "Notification" ADD COLUMN "resendMode" TEXT;

CREATE INDEX "Notification_resendOfNotificationId_idx"
  ON "Notification"("resendOfNotificationId");
