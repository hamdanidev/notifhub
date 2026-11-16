-- Optional round-trip data for the visual email block builder.
-- The worker continues to render the generated `body`; builderData is never read at delivery time.
ALTER TABLE "NotificationTemplate"
  ADD COLUMN "builderData" JSONB;
