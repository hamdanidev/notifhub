import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  @ApiProperty({ format: 'email', example: 'admin@notifhub.local' })
  @IsEmail()
  @MaxLength(320)
  email!: string;

  @ApiProperty({ minLength: 8, writeOnly: true })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;
}

export class AdminProfileDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  email!: string;

  @ApiProperty({ example: 'tenant_admin' })
  role!: string;

  @ApiProperty()
  tenantId!: string;
}

export class LoginResponseDto {
  @ApiProperty()
  accessToken!: string;

  @ApiProperty({ example: 'Bearer' })
  tokenType!: string;

  @ApiProperty({ example: 3600, description: 'Token lifetime in seconds' })
  expiresIn!: number;

  @ApiProperty({ type: AdminProfileDto })
  admin!: AdminProfileDto;
}
