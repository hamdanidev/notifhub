import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Channel } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { AdminListQueryDto } from './list-query.dto';

export const TEMPLATE_KEY_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;

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
  @Type(() => Boolean)
  @IsBoolean()
  active?: boolean;
}

export class CreateTemplateDto {
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

  @ApiProperty({ minLength: 1 })
  @IsString()
  @MinLength(1)
  body!: string;

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

  @ApiPropertyOptional({ maxLength: 64 })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  fallbackProvider?: string;

  @ApiPropertyOptional({ enum: Channel })
  @IsOptional()
  @IsEnum(Channel)
  fallbackChannel?: Channel;
}

export class UpdateTemplateDto {
  @ApiPropertyOptional({ maxLength: 255 })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  subject?: string;

  @ApiPropertyOptional({ minLength: 1 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  body?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({ maxLength: 64 })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  fallbackProvider?: string;

  @ApiPropertyOptional({ enum: Channel })
  @IsOptional()
  @IsEnum(Channel)
  fallbackChannel?: Channel;
}
