import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Channel } from '@prisma/client';
import { IsBoolean, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { IsTimeZone } from '../../subscribers/dto/upsert-subscriber.dto';

export const QUIET_HOURS_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

export class UpdatePreferenceDto {
  @ApiProperty()
  @IsBoolean()
  enabled!: boolean;

  @ApiPropertyOptional({ example: '22:00' })
  @IsOptional()
  @IsString()
  @Matches(QUIET_HOURS_PATTERN)
  quietHoursStart?: string;

  @ApiPropertyOptional({ example: '07:00' })
  @IsOptional()
  @IsString()
  @Matches(QUIET_HOURS_PATTERN)
  quietHoursEnd?: string;

  @ApiPropertyOptional({ example: 'Asia/Jakarta' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  @IsTimeZone()
  timezone?: string;
}

export class PreferenceResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  recipientId!: string;

  @ApiProperty({ enum: Channel })
  channel!: Channel;

  @ApiProperty()
  enabled!: boolean;

  @ApiProperty({ type: String, nullable: true })
  quietHoursStart!: string | null;

  @ApiProperty({ type: String, nullable: true })
  quietHoursEnd!: string | null;

  @ApiProperty()
  timezone!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}
