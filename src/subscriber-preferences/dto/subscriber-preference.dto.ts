import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Channel } from '@prisma/client';
import { IsBoolean, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { IsTimeZone } from '../../subscribers/dto/upsert-subscriber.dto';

export const QUIET_HOURS_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

/**
 * Body of `PUT /subscriber/preferences/:channel`.
 *
 * Same rules as the admin API, with one difference: when `timezone` is omitted the value is
 * inherited from the subscriber record instead of being forced to Asia/Jakarta.
 */
export class UpdateSubscriberPreferenceDto {
  @ApiProperty({ example: true })
  @IsBoolean()
  enabled!: boolean;

  @ApiPropertyOptional({ example: '22:00', description: 'HH:mm, must be sent together with quietHoursEnd' })
  @IsOptional()
  @IsString()
  @Matches(QUIET_HOURS_PATTERN)
  quietHoursStart?: string;

  @ApiPropertyOptional({ example: '07:00', description: 'HH:mm, must be sent together with quietHoursStart' })
  @IsOptional()
  @IsString()
  @Matches(QUIET_HOURS_PATTERN)
  quietHoursEnd?: string;

  @ApiPropertyOptional({ example: 'Asia/Jakarta', description: 'IANA timezone; inherits the subscriber timezone when omitted' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  @IsTimeZone()
  timezone?: string;
}

export class ChannelPreferenceResponseDto {
  @ApiProperty({ enum: Channel })
  channel!: Channel;

  @ApiProperty()
  enabled!: boolean;

  @ApiProperty({ type: String, nullable: true })
  quietHoursStart!: string | null;

  @ApiProperty({ type: String, nullable: true })
  quietHoursEnd!: string | null;

  @ApiProperty({ example: 'Asia/Jakarta' })
  timezone!: string;

  @ApiProperty({
    description: 'True when no preference row exists and the effective defaults are returned',
  })
  isDefault!: boolean;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  updatedAt!: string | null;
}

export class SubscriberPreferencesResponseDto {
  @ApiProperty()
  recipientId!: string;

  @ApiProperty({ type: String, nullable: true })
  locale!: string | null;

  @ApiProperty({ example: 'Asia/Jakarta' })
  timezone!: string;

  @ApiProperty({ type: [ChannelPreferenceResponseDto] })
  channels!: ChannelPreferenceResponseDto[];
}
