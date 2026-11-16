import { ApiPropertyOptional } from '@nestjs/swagger';
import { OverallStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsISO8601, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export const ADMIN_DEFAULT_LIMIT = 20;
export const ADMIN_MAX_LIMIT = 100;

export class AdminListQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: ADMIN_MAX_LIMIT, default: ADMIN_DEFAULT_LIMIT })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(ADMIN_MAX_LIMIT)
  limit?: number;

  @ApiPropertyOptional({ minimum: 0, default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;

  @ApiPropertyOptional({ description: 'Free-text search (resource specific)' })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  search?: string;
}

export class NotificationListQueryDto extends AdminListQueryDto {
  @ApiPropertyOptional({ enum: OverallStatus })
  @IsOptional()
  @IsEnum(OverallStatus)
  status?: OverallStatus;

  @ApiPropertyOptional({ maxLength: 128 })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  templateKey?: string;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsISO8601()
  to?: string;
}
