import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { plainToInstance, Transform, type TransformFnParams, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsIn,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Channel } from '@prisma/client';
import { RecipientInput } from './recipient-input.dto';

export const NOTIFICATION_PRIORITIES = ['low', 'normal', 'high', 'critical'] as const;
export type NotificationPriority = (typeof NOTIFICATION_PRIORITIES)[number];

export const DEFAULT_PRIORITY: NotificationPriority = 'normal';
export const MAX_RECIPIENTS_PER_REQUEST = 1000;
export const MAX_TOPICS_PER_REQUEST = 50;
export const TOPIC_KEY_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;

/**
 * Normalizes `["user-1", { id: "user-2" }]` into `[{ id: "user-1" }, { id: "user-2" }]`
 * before nested validation runs. String entries become RecipientInput instances so
 * ValidationPipe's whitelist can validate them.
 */
function normalizeRecipients({ value }: TransformFnParams): unknown {
  if (!Array.isArray(value)) {
    return value;
  }

  return value.map((entry: unknown) =>
    typeof entry === 'string' ? plainToInstance(RecipientInput, { id: entry }) : entry,
  );
}

export class NotifyDto {
  @ApiProperty({
    description:
      'Idempotency key scoped to the caller. Repeating a request with the same key within IDEMPOTENCY_TTL_DAYS returns the original notification id.',
    maxLength: 128,
    example: 'order-1234-created',
  })
  @IsString()
  @MaxLength(128)
  @Matches(/^[a-zA-Z0-9._:-]+$/, {
    message: 'idempotency_key may only contain letters, digits, dot, underscore, colon and hyphen',
  })
  idempotency_key!: string;

  @ApiProperty({
    description: 'Template key resolved per channel and locale',
    maxLength: 128,
    example: 'test.notification',
  })
  @IsString()
  @MaxLength(128)
  template_key!: string;

  @ApiPropertyOptional({
    description:
      'Recipient identifiers, or inline recipient objects. Strings are normalized to { id }. Duplicates are removed by id. Optional when topics are provided.',
    isArray: true,
    minItems: 1,
    maxItems: MAX_RECIPIENTS_PER_REQUEST,
    example: ['user-1', { id: 'user-2', email: 'user2@example.com', locale: 'id' }],
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_RECIPIENTS_PER_REQUEST)
  @Transform(normalizeRecipients)
  @ValidateNested({ each: true })
  @Type(() => RecipientInput)
  recipients?: (string | RecipientInput)[];

  @ApiPropertyOptional({
    description:
      'Topic keys to fan out to. Topics are created by the membership push API; unknown keys are rejected with 400.',
    isArray: true,
    maxItems: MAX_TOPICS_PER_REQUEST,
    example: ['shift:gudang'],
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_TOPICS_PER_REQUEST)
  @IsString({ each: true })
  @Matches(TOPIC_KEY_PATTERN, { each: true })
  topics?: string[];

  @ApiProperty({
    description: 'Template data. Stored with the notification and passed to the renderer.',
    type: 'object',
    additionalProperties: true,
    example: { nama: 'Budi' },
  })
  @IsObject()
  data!: Record<string, unknown>;

  @ApiPropertyOptional({
    description: 'Channels to deliver on. Defaults to ["inapp"].',
    enum: Channel,
    isArray: true,
    example: ['inapp'],
  })
  @IsOptional()
  @IsArray()
  @IsEnum(Channel, { each: true })
  channels?: Channel[];

  @ApiPropertyOptional({
    description: 'Delivery priority. Maps to BullMQ priority 1 (critical) .. 4 (low).',
    enum: NOTIFICATION_PRIORITIES,
    default: DEFAULT_PRIORITY,
    example: 'normal',
  })
  @IsOptional()
  @IsIn(NOTIFICATION_PRIORITIES)
  priority?: NotificationPriority;

  @ApiPropertyOptional({
    description:
      'ISO 8601 timestamp. Accepted and stored in the payload, but NOT scheduled or processed in Phase 1.',
    format: 'date-time',
    example: '2026-01-01T10:00:00.000Z',
  })
  @IsOptional()
  @IsISO8601()
  scheduled_at?: string;

  @ApiPropertyOptional({
    description:
      'Deprecated. The tenant is taken from the API key; a value must match it when provided.',
    maxLength: 64,
    example: 'default',
    deprecated: true,
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  tenant_id?: string;
}
