import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsISO8601, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export const ADMIN_AUDIT_DEFAULT_LIMIT = 50;
export const ADMIN_AUDIT_MAX_LIMIT = 100;

export class AdminAuditQueryDto {
  @ApiPropertyOptional({ maxLength: 80 })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  action?: string;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsISO8601()
  to?: string;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: ADMIN_AUDIT_MAX_LIMIT,
    default: ADMIN_AUDIT_DEFAULT_LIMIT,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(ADMIN_AUDIT_MAX_LIMIT)
  limit?: number;

  @ApiPropertyOptional({ minimum: 0, default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}

export class AdminAuditEventDto {
  @ApiProperty({ description: 'Auto-increment id serialized as string' })
  id!: string;

  @ApiProperty()
  actorAdminId!: string;

  @ApiProperty()
  actorEmail!: string;

  @ApiProperty({ example: 'admin.api_key.created' })
  action!: string;

  @ApiProperty()
  targetType!: string;

  @ApiProperty()
  targetId!: string;

  @ApiProperty({ type: Object, nullable: true })
  metadata!: unknown;

  @ApiProperty({ type: String, nullable: true })
  ip!: string | null;

  @ApiProperty({ type: String, nullable: true })
  requestId!: string | null;

  @ApiProperty({ format: 'date-time' })
  occurredAt!: string;
}

export class AdminAuditListResponseDto {
  @ApiProperty({ type: [AdminAuditEventDto] })
  items!: AdminAuditEventDto[];

  @ApiProperty()
  total!: number;

  @ApiProperty()
  limit!: number;

  @ApiProperty()
  offset!: number;
}
