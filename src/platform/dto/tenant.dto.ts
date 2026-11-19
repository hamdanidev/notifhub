import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TenantStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import {
  PLATFORM_AUDIT_DEFAULT_LIMIT,
  PLATFORM_AUDIT_MAX_LIMIT,
  TENANT_ADMIN_PASSWORD_MIN_LENGTH,
  TENANT_DEFAULT_LIST_LIMIT,
  TENANT_ID_PATTERN,
  TENANT_MAX_LIST_LIMIT,
  TENANT_NAME_MAX_LENGTH,
} from '../platform.constants';

export class CreateTenantDto {
  @ApiProperty({ example: 'acme', description: 'Immutable tenant id (lowercase slug)' })
  @IsString()
  @Matches(TENANT_ID_PATTERN, { message: 'invalid_tenant_id' })
  id!: string;

  @ApiProperty({ example: 'Acme Corp', maxLength: TENANT_NAME_MAX_LENGTH })
  @IsString()
  @MinLength(1)
  @MaxLength(TENANT_NAME_MAX_LENGTH)
  name!: string;
}

export class UpdateTenantDto {
  @ApiProperty({ example: 'Acme Corporation', maxLength: TENANT_NAME_MAX_LENGTH })
  @IsString()
  @MinLength(1)
  @MaxLength(TENANT_NAME_MAX_LENGTH)
  name!: string;
}

export class ListTenantsQueryDto {
  @ApiPropertyOptional({ enum: TenantStatus })
  @IsOptional()
  @IsEnum(TenantStatus)
  status?: TenantStatus;

  @ApiPropertyOptional({ description: 'Search tenant id or name', maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: TENANT_MAX_LIST_LIMIT, default: TENANT_DEFAULT_LIST_LIMIT })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(TENANT_MAX_LIST_LIMIT)
  limit?: number;

  @ApiPropertyOptional({ minimum: 0, default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}

export class TenantDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ enum: TenantStatus })
  status!: TenantStatus;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  suspendedAt!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;

  @ApiProperty()
  adminCount!: number;

  @ApiProperty()
  apiKeyCount!: number;
}

export class TenantListResponseDto {
  @ApiProperty({ type: [TenantDto] })
  items!: TenantDto[];

  @ApiProperty()
  total!: number;

  @ApiProperty()
  limit!: number;

  @ApiProperty()
  offset!: number;
}

export class TenantAdminDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  email!: string;

  @ApiProperty({ example: 'tenant_admin' })
  role!: string;

  @ApiProperty()
  active!: boolean;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  lastLoginAt!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

export class CreateTenantAdminDto {
  @ApiProperty({ format: 'email' })
  @IsEmail()
  @MaxLength(320)
  email!: string;

  @ApiProperty({ minLength: TENANT_ADMIN_PASSWORD_MIN_LENGTH, writeOnly: true })
  @IsString()
  @MinLength(TENANT_ADMIN_PASSWORD_MIN_LENGTH)
  @MaxLength(128)
  password!: string;
}

export class UpdateTenantAdminDto {
  @ApiPropertyOptional({ minLength: TENANT_ADMIN_PASSWORD_MIN_LENGTH, writeOnly: true })
  @IsOptional()
  @IsString()
  @MinLength(TENANT_ADMIN_PASSWORD_MIN_LENGTH)
  @MaxLength(128)
  password?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class ListAuditQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(63)
  tenantId?: string;

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
    maximum: PLATFORM_AUDIT_MAX_LIMIT,
    default: PLATFORM_AUDIT_DEFAULT_LIMIT,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(PLATFORM_AUDIT_MAX_LIMIT)
  limit?: number;

  @ApiPropertyOptional({ minimum: 0, default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}

export class PlatformAuditEventDto {
  @ApiProperty({ description: 'Auto-increment id serialized as string' })
  id!: string;

  @ApiProperty()
  actorAdminId!: string;

  @ApiProperty()
  actorEmail!: string;

  @ApiProperty({ example: 'tenant.suspended' })
  action!: string;

  @ApiProperty({ type: String, nullable: true })
  tenantId!: string | null;

  @ApiProperty({ example: 'tenant' })
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

export class PlatformAuditListResponseDto {
  @ApiProperty({ type: [PlatformAuditEventDto] })
  items!: PlatformAuditEventDto[];

  @ApiProperty()
  total!: number;

  @ApiProperty()
  limit!: number;

  @ApiProperty()
  offset!: number;
}
