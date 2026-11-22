import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  Channel,
  TemplateDirection,
  TemplateFormat,
  TemplateStatus,
} from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { AdminListQueryDto } from './list-query.dto';

export const TEMPLATE_KEY_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;
export const TEMPLATE_BODY_MAX_LENGTH = 262_144;

const booleanTransform = ({ value }: { value: unknown }): unknown => {
  if (value === 'true' || value === true) {
    return true;
  }
  if (value === 'false' || value === false) {
    return false;
  }
  return value;
};

export class TemplateListQueryDto extends AdminListQueryDto {
  @ApiPropertyOptional({ enum: Channel })
  @IsOptional()
  @IsEnum(Channel)
  channel?: Channel;

  @ApiPropertyOptional({ maxLength: 16 })
  @IsOptional()
  @IsString()
  @MaxLength(16)
  locale?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(booleanTransform)
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({ enum: TemplateStatus })
  @IsOptional()
  @IsEnum(TemplateStatus)
  status?: TemplateStatus;

  @ApiPropertyOptional({ enum: TemplateFormat })
  @IsOptional()
  @IsEnum(TemplateFormat)
  format?: TemplateFormat;

  @ApiPropertyOptional({ enum: ['summary', 'full'], default: 'full' })
  @IsOptional()
  @IsIn(['summary', 'full'])
  view?: 'summary' | 'full';
}

export class TemplateVariablesDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  variables?: unknown;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  sampleData?: unknown;

  @ApiPropertyOptional({ description: 'Opaque visual builder document (round-trip only)' })
  @IsOptional()
  @IsObject()
  builderData?: unknown;
}

export class CreateTemplateDto extends TemplateVariablesDto {
  @ApiProperty({ maxLength: 128, example: 'order.shipped' })
  @IsString()
  @Matches(TEMPLATE_KEY_PATTERN)
  key!: string;

  @ApiProperty({ enum: Channel })
  @IsEnum(Channel)
  channel!: Channel;

  @ApiProperty({ maxLength: 16, example: 'id' })
  @IsString()
  @MaxLength(16)
  locale!: string;

  @ApiPropertyOptional({ maxLength: 255 })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  subject?: string;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  preheader?: string;

  @ApiProperty({ minLength: 1, maxLength: TEMPLATE_BODY_MAX_LENGTH })
  @IsString()
  @MinLength(1)
  @MaxLength(TEMPLATE_BODY_MAX_LENGTH)
  body!: string;

  @ApiPropertyOptional({ enum: TemplateFormat })
  @IsOptional()
  @IsEnum(TemplateFormat)
  format?: TemplateFormat;

  @ApiPropertyOptional({ enum: TemplateDirection })
  @IsOptional()
  @IsEnum(TemplateDirection)
  direction?: TemplateDirection;

  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version?: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({ enum: TemplateStatus, default: 'published' })
  @IsOptional()
  @IsEnum(TemplateStatus)
  status?: TemplateStatus;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  strictVariables?: boolean;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  layoutId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  themeId?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsUUID(undefined, { each: true })
  partialIds?: string[];

  @ApiPropertyOptional({ maxLength: 64 })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  fallbackProvider?: string;

  @ApiPropertyOptional({ enum: Channel })
  @IsOptional()
  @IsEnum(Channel)
  fallbackChannel?: Channel;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class UpdateTemplateDto {
  @ApiPropertyOptional({ maxLength: 255 })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  subject?: string | null;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  preheader?: string | null;

  @ApiPropertyOptional({ minLength: 1, maxLength: TEMPLATE_BODY_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(TEMPLATE_BODY_MAX_LENGTH)
  body?: string;

  @ApiPropertyOptional({ enum: TemplateFormat })
  @IsOptional()
  @IsEnum(TemplateFormat)
  format?: TemplateFormat;

  @ApiPropertyOptional({ enum: TemplateDirection })
  @IsOptional()
  @IsEnum(TemplateDirection)
  direction?: TemplateDirection;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  strictVariables?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  variables?: unknown;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  sampleData?: unknown;

  @ApiPropertyOptional({ description: 'Opaque visual builder document (round-trip only)' })
  @IsOptional()
  @IsObject()
  builderData?: unknown;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @IsOptional()
  @IsUUID()
  layoutId?: string | null;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @IsOptional()
  @IsUUID()
  themeId?: string | null;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsUUID(undefined, { each: true })
  partialIds?: string[];

  @ApiPropertyOptional({ maxLength: 64 })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  fallbackProvider?: string | null;

  @ApiPropertyOptional({ enum: Channel })
  @IsOptional()
  @IsEnum(Channel)
  fallbackChannel?: Channel | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  expectedRevision?: number;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class PublishTemplateDto {
  @ApiProperty({ minimum: 0 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  expectedRevision!: number;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  @ApiPropertyOptional({
    maxLength: 500,
    description:
      'Alasan self-approval; wajib (min. 20 karakter) pada tenant dengan mode self_approval_allowed tanpa approval reviewer.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  selfApprovalReason?: string;
}

export class CloneTemplateDto {
  @ApiPropertyOptional({ maxLength: 128 })
  @IsOptional()
  @IsString()
  @Matches(TEMPLATE_KEY_PATTERN)
  key?: string;

  @ApiPropertyOptional({ maxLength: 16 })
  @IsOptional()
  @IsString()
  @MaxLength(16)
  locale?: string;

  @ApiPropertyOptional({ minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version?: number;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class RollbackTemplateDto {
  @ApiProperty({ minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  sourceVersion!: number;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class PreviewTemplateDto {
  @ApiProperty({ enum: Channel })
  @IsEnum(Channel)
  channel!: Channel;

  @ApiPropertyOptional({ enum: TemplateFormat })
  @IsOptional()
  @IsEnum(TemplateFormat)
  format?: TemplateFormat;

  @ApiPropertyOptional({ maxLength: 255 })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  subject?: string;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  preheader?: string;

  @ApiProperty({ minLength: 1, maxLength: TEMPLATE_BODY_MAX_LENGTH })
  @IsString()
  @MinLength(1)
  @MaxLength(TEMPLATE_BODY_MAX_LENGTH)
  body!: string;

  @ApiPropertyOptional({ maxLength: 16 })
  @IsOptional()
  @IsString()
  @MaxLength(16)
  locale?: string;

  @ApiPropertyOptional({ enum: TemplateDirection })
  @IsOptional()
  @IsEnum(TemplateDirection)
  direction?: TemplateDirection;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  strictVariables?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  variables?: unknown;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  sampleData?: unknown;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  layoutId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  themeId?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsUUID(undefined, { each: true })
  partialIds?: string[];
}

export class PreviewSavedTemplateDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  sampleData?: unknown;

  @ApiPropertyOptional({ maxLength: 16 })
  @IsOptional()
  @IsString()
  @MaxLength(16)
  locale?: string;

  @ApiPropertyOptional({ enum: TemplateDirection })
  @IsOptional()
  @IsEnum(TemplateDirection)
  direction?: TemplateDirection;
}

export class TestSendTemplateDto {
  @ApiProperty({ description: 'Email address or E.164 WhatsApp number', maxLength: 320 })
  @IsString()
  @MinLength(3)
  @MaxLength(320)
  recipient!: string;

  @ApiPropertyOptional({ maxLength: 128 })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  requestKey?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  sampleData?: unknown;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class TemplateAuditQueryDto extends AdminListQueryDto {}
