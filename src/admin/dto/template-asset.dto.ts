import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { AdminListQueryDto } from './list-query.dto';
import { ASSET_KEY_PATTERN } from '../../templates/template.safety';
import { TEMPLATE_BODY_MAX_LENGTH } from './template.dto';

const booleanTransform = ({ value }: { value: unknown }): unknown => {
  if (value === 'true' || value === true) {
    return true;
  }
  if (value === 'false' || value === false) {
    return false;
  }
  return value;
};

export class TemplateAssetListQueryDto extends AdminListQueryDto {
  @ApiPropertyOptional({ maxLength: 64 })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  key?: string;

  @ApiPropertyOptional({ description: 'Only return the highest version per key' })
  @IsOptional()
  @Transform(booleanTransform)
  @IsBoolean()
  latest?: boolean;
}

export class CreateTemplateLayoutDto {
  @ApiProperty({ maxLength: 64, example: 'base' })
  @IsString()
  @MaxLength(64)
  @Matches(ASSET_KEY_PATTERN)
  key!: string;

  @ApiProperty({ maxLength: 120 })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @ApiProperty({ maxLength: TEMPLATE_BODY_MAX_LENGTH })
  @IsString()
  @MinLength(1)
  @MaxLength(TEMPLATE_BODY_MAX_LENGTH)
  content!: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class CreateTemplateThemeDto {
  @ApiProperty({ maxLength: 64, example: 'brand' })
  @IsString()
  @MaxLength(64)
  @Matches(ASSET_KEY_PATTERN)
  key!: string;

  @ApiProperty({ maxLength: 120 })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @ApiProperty({ type: 'object', additionalProperties: true })
  @IsObject()
  tokens!: Record<string, unknown>;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class CreateTemplatePartialDto {
  @ApiProperty({ maxLength: 64, example: 'footer' })
  @IsString()
  @MaxLength(64)
  @Matches(ASSET_KEY_PATTERN)
  key!: string;

  @ApiProperty({ maxLength: 120 })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @ApiProperty({ maxLength: TEMPLATE_BODY_MAX_LENGTH })
  @IsString()
  @MinLength(1)
  @MaxLength(TEMPLATE_BODY_MAX_LENGTH)
  content!: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
