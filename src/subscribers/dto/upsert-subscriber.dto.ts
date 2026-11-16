import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  registerDecorator,
  type ValidationOptions,
} from 'class-validator';

/** Validates an IANA timezone name using the runtime's Intl database. */
export function IsTimeZone(validationOptions?: ValidationOptions): PropertyDecorator {
  return (object: object, propertyName: string | symbol): void => {
    registerDecorator({
      name: 'isTimeZone',
      target: object.constructor,
      propertyName: String(propertyName),
      options: validationOptions,
      validator: {
        validate(value: unknown): boolean {
          if (typeof value !== 'string' || value.length === 0) {
            return false;
          }

          try {
            new Intl.DateTimeFormat('en-US', { timeZone: value }).format(new Date());
            return true;
          } catch {
            return false;
          }
        },
        defaultMessage(): string {
          return '$property must be a valid IANA timezone (e.g. Asia/Jakarta)';
        },
      },
    });
  };
}

/**
 * PUT /subscribers/:externalId body. Push-synced by the consumer: fields that are omitted
 * are cleared (full replacement), except timezone which falls back to Asia/Jakarta.
 */
export class UpsertSubscriberDto {
  @ApiPropertyOptional({ format: 'email', maxLength: 320, example: 'user@example.com' })
  @IsOptional()
  @IsEmail()
  @MaxLength(320)
  email?: string;

  @ApiPropertyOptional({ maxLength: 32, example: '+628123456789' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  phone?: string;

  @ApiPropertyOptional({ maxLength: 16, example: 'id' })
  @IsOptional()
  @IsString()
  @MaxLength(16)
  locale?: string;

  @ApiPropertyOptional({ maxLength: 64, example: 'Asia/Jakarta' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  @IsTimeZone()
  timezone?: string;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    example: { plan: 'pro' },
  })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
