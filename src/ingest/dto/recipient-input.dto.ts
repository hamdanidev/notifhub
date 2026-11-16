import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Inline recipient object. Overrides the Subscriber record for this request only.
 * Phase 3 adds Subscriber CRUD; Phase 1 accepts the object inline.
 */
export class RecipientInput {
  @ApiProperty({
    description: 'Consumer-defined recipient identifier',
    maxLength: 128,
    example: 'user-123',
  })
  @IsString()
  @MaxLength(128)
  id!: string;

  @ApiPropertyOptional({
    description: 'Email address used by the email channel for this request',
    maxLength: 320,
    example: 'user@example.com',
  })
  @IsOptional()
  @IsEmail()
  @MaxLength(320)
  email?: string;

  @ApiPropertyOptional({
    description: 'Phone number used by the WhatsApp channel for this request',
    maxLength: 32,
    example: '+628123456789',
  })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  phone?: string;

  @ApiPropertyOptional({
    description: 'Locale override for template resolution',
    maxLength: 16,
    example: 'id',
  })
  @IsOptional()
  @IsString()
  @MaxLength(16)
  locale?: string;

  @ApiPropertyOptional({
    description: 'IANA timezone override, used for quiet hours evaluation',
    maxLength: 64,
    example: 'Asia/Jakarta',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string;
}
