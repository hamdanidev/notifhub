import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Channel } from '@prisma/client';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';
import { MAX_RECIPIENTS_PER_REQUEST, MAX_TOPICS_PER_REQUEST, TOPIC_KEY_PATTERN } from '../../ingest/dto/notify.dto';

export type ComposePriority = 'low' | 'normal' | 'high';

/**
 * Body of `POST /admin/notifications` (compose from the console).
 *
 * Tenant always comes from the admin JWT. `requestKey` is the ingest idempotency key, so a
 * retried submit returns the same notification instead of sending twice.
 */
export class ComposeNotificationDto {
  @ApiProperty({
    format: 'uuid',
    description: 'Console-generated idempotency key for this compose action.',
  })
  @IsUUID()
  requestKey!: string;

  @ApiProperty({ maxLength: 128, example: 'order.shipped' })
  @IsString()
  @MaxLength(128)
  templateKey!: string;

  @ApiPropertyOptional({
    type: [String],
    maxItems: MAX_RECIPIENTS_PER_REQUEST,
    example: ['user-1', 'user-2'],
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_RECIPIENTS_PER_REQUEST)
  @IsString({ each: true })
  @MaxLength(128, { each: true })
  recipients?: string[];

  @ApiPropertyOptional({
    type: [String],
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

  @ApiProperty({ enum: Channel, isArray: true, example: ['inapp', 'email'] })
  @IsArray()
  @ArrayMinSize(1)
  @IsEnum(Channel, { each: true })
  channels!: Channel[];

  @ApiPropertyOptional({ type: 'object', additionalProperties: true, example: { nama: 'Budi' } })
  @IsOptional()
  @IsObject()
  data?: Record<string, unknown>;

  @ApiPropertyOptional({ enum: ['low', 'normal', 'high'], default: 'normal' })
  @IsOptional()
  @IsIn(['low', 'normal', 'high'])
  priority?: ComposePriority;
}
