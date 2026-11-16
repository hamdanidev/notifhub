import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateApiKeyDto {
  @ApiProperty({ maxLength: 80, example: 'order-service' })
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name!: string;

  @ApiPropertyOptional({ type: [String], maxItems: 20 })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsUrl({ require_tld: false }, { each: true })
  allowedOrigins?: string[];

  @ApiPropertyOptional({
    minLength: 32,
    description:
      'Secret used to verify this API key tenant subscriber JWTs (HS256). When omitted, the tenant falls back to SUBSCRIBER_JWT_SECRET until a secret is set.',
    writeOnly: true,
  })
  @IsOptional()
  @IsString()
  @MinLength(32)
  @MaxLength(128)
  subscriberJwtSecret?: string;
}

export class ApiKeySummaryDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  tenantId!: string;

  @ApiProperty()
  active!: boolean;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  lastUsedAt!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

export class CreatedApiKeyResponseDto extends ApiKeySummaryDto {
  @ApiProperty({ description: 'Raw API key, returned exactly once' })
  key!: string;

  @ApiProperty({ example: 'nhk_abcd...wxyz' })
  keyPreview!: string;
}

export class RevokedApiKeyResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ example: false })
  active!: boolean;
}
