import { ApiPropertyOptional } from '@nestjs/swagger';
import { OverallStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export const EXPORT_DEFAULT_LIMIT = 5_000;
export const EXPORT_MAX_LIMIT = 5_000;

/**
 * Query for `GET /admin/notifications/export`. Mirrors the list filters but allows a larger,
 * capped row count because the console builds the CSV client-side from this JSON response.
 */
export class ExportNotificationsQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: EXPORT_MAX_LIMIT, default: EXPORT_DEFAULT_LIMIT })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(EXPORT_MAX_LIMIT)
  limit?: number;

  @ApiPropertyOptional({ enum: OverallStatus })
  @IsOptional()
  @IsEnum(OverallStatus)
  status?: OverallStatus;

  @ApiPropertyOptional({ maxLength: 128 })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  templateKey?: string;

  @ApiPropertyOptional({ description: 'Exact notification id or recipient id' })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  search?: string;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsISO8601()
  to?: string;
}
