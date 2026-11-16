import { ApiProperty } from '@nestjs/swagger';

export class SubscriberResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'default' })
  tenantId!: string;

  @ApiProperty({ example: 'user-123' })
  externalId!: string;

  @ApiProperty({ type: String, nullable: true })
  email!: string | null;

  @ApiProperty({ type: String, nullable: true })
  phone!: string | null;

  @ApiProperty({ type: String, nullable: true })
  locale!: string | null;

  @ApiProperty({ example: 'Asia/Jakarta' })
  timezone!: string;

  @ApiProperty({ type: 'object', additionalProperties: true, nullable: true })
  metadata!: Record<string, unknown> | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}
