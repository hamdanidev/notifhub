import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsISO8601,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export const MAX_TOPIC_MEMBERS = 1000;

export class TopicMemberDto {
  @ApiProperty({ maxLength: 128, example: 'user-123' })
  @IsString()
  @MaxLength(128)
  recipientId!: string;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsISO8601()
  expiresAt?: string;
}

export class TopicMembersBodyDto {
  @ApiProperty({ type: [TopicMemberDto], maxItems: MAX_TOPIC_MEMBERS })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_TOPIC_MEMBERS)
  @ValidateNested({ each: true })
  @Type(() => TopicMemberDto)
  members!: TopicMemberDto[];

  @ApiPropertyOptional({
    format: 'date-time',
    description: 'Default expiry applied to members that do not set their own',
  })
  @IsOptional()
  @IsISO8601()
  expiresAt?: string;

  @ApiPropertyOptional({
    description: 'Only honoured when the topic is created by this request',
  })
  @IsOptional()
  @IsBoolean()
  isTimeBound?: boolean;
}

export class TopicQueryDto {
  @ApiPropertyOptional({ description: 'Include expired members', default: false })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  includeExpired?: boolean;
}

export class TopicViewDto {
  @ApiProperty()
  key!: string;

  @ApiProperty()
  isTimeBound!: boolean;

  @ApiProperty({ enum: ['push', 'self-service'] })
  mode!: string;
}

export class TopicMemberViewDto {
  @ApiProperty()
  recipientId!: string;

  @ApiProperty({ format: 'date-time' })
  addedAt!: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  expiresAt!: string | null;
}

export class TopicMutationResponseDto {
  @ApiProperty({ type: TopicViewDto })
  topic!: TopicViewDto;

  @ApiProperty()
  memberCount!: number;

  @ApiPropertyOptional()
  removed?: number;

  @ApiPropertyOptional()
  added?: number;

  @ApiPropertyOptional()
  updated?: number;
}

export class TopicMembersResponseDto {
  @ApiProperty({ type: TopicViewDto })
  topic!: TopicViewDto;

  @ApiProperty({ type: [TopicMemberViewDto] })
  members!: TopicMemberViewDto[];

  @ApiProperty()
  expiredCount!: number;
}
