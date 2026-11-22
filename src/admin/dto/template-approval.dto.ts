import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TemplateApprovalStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { AdminListQueryDto } from './list-query.dto';

export class SubmitReviewDto {
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
}

export class ApprovalNoteDto {
  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class RejectApprovalDto {
  @ApiProperty({ maxLength: 500, minLength: 1 })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  note!: string;
}

export class ApprovalQueueQueryDto extends AdminListQueryDto {
  @ApiPropertyOptional({ enum: TemplateApprovalStatus })
  @IsOptional()
  @IsEnum(TemplateApprovalStatus)
  status?: TemplateApprovalStatus;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  templateId?: string;
}
