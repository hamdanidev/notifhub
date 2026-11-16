import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Channel } from '@prisma/client';
import {
  IsEnum,
  IsIn,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export const WEBHOOK_EVENT_TYPES = [
  'delivered',
  'failed',
  'bounced',
  'read',
  'opened',
] as const;

export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number];

export class WebhookEventDto {
  @ApiProperty({ description: 'Provider event id, stored in the raw payload for audit' })
  @IsString()
  @MaxLength(128)
  eventId!: string;

  @ApiProperty({ enum: WEBHOOK_EVENT_TYPES })
  @IsIn(WEBHOOK_EVENT_TYPES)
  eventType!: WebhookEventType;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  notificationId!: string;

  @ApiProperty({ maxLength: 128 })
  @IsString()
  @MaxLength(128)
  recipientId!: string;

  @ApiPropertyOptional({
    enum: Channel,
    description: 'Defaults to the channel implied by the provider path',
  })
  @IsOptional()
  @IsEnum(Channel)
  channel?: Channel;

  @ApiPropertyOptional({ maxLength: 256 })
  @IsOptional()
  @IsString()
  @MaxLength(256)
  providerMessageId?: string;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsISO8601()
  occurredAt?: string;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
