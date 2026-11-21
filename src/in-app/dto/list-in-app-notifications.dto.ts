import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export const DEFAULT_IN_APP_PAGE_SIZE = 20;
export const MAX_IN_APP_PAGE_SIZE = 100;

export class ListInAppNotificationsDto {
  @ApiPropertyOptional({
    description: 'Maximum number of notifications to return',
    minimum: 1,
    maximum: MAX_IN_APP_PAGE_SIZE,
    default: DEFAULT_IN_APP_PAGE_SIZE,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_IN_APP_PAGE_SIZE)
  limit?: number;

  @ApiPropertyOptional({
    description: 'Opaque cursor returned as nextCursor by the previous page',
    maxLength: 512,
  })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  cursor?: string;
}

export class InAppNotificationItem {
  @ApiProperty({ format: 'uuid' })
  notificationId!: string;

  @ApiProperty({ example: 'test.notification' })
  templateKey!: string;

  @ApiProperty({ type: String, nullable: true })
  subject!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Rendered in-app body. Null when the template no longer exists.',
  })
  body!: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description:
      'Sanitized HTML for markdown templates. Null for plain-text templates and missing templates.',
  })
  bodyHtml?: string | null;

  @ApiPropertyOptional({
    enum: ['text', 'markdown'],
    description: 'Body format of the template that produced this notification.',
  })
  format?: string;

  @ApiProperty({ type: 'object', additionalProperties: true })
  data!: Record<string, unknown>;

  @ApiProperty({ example: 3, description: '1=critical, 2=high, 3=normal, 4=low' })
  priority!: number;

  @ApiProperty({ enum: ['pending', 'sent', 'failed', 'read', 'skipped'] })
  status!: string;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  readAt!: string | null;
}

export class InAppNotificationPage {
  @ApiProperty({ type: [InAppNotificationItem] })
  items!: InAppNotificationItem[];

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Cursor for the next page, null when there are no more items',
  })
  nextCursor!: string | null;
}

export class ReadReceiptResponse {
  @ApiProperty({ format: 'uuid' })
  notificationId!: string;

  @ApiProperty({ format: 'date-time' })
  readAt!: string;
}
