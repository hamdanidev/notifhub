import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

/** Platform login uses the same credential shape as the tenant login. */
export class PlatformLoginDto {
  @ApiProperty({ format: 'email', example: 'ops@notifhub.local' })
  @IsEmail()
  @MaxLength(320)
  email!: string;

  @ApiProperty({ minLength: 8, writeOnly: true })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;
}

/**
 * Platform admin profile. Intentionally has no `tenantId`: a platform admin is not bound to a
 * tenant, and the published `@notifhub/js` AdminProfile type stays unchanged.
 */
export class PlatformAdminProfileDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  email!: string;

  @ApiProperty({ example: 'platform_admin' })
  role!: string;
}

export class PlatformLoginResponseDto {
  @ApiProperty()
  accessToken!: string;

  @ApiProperty({ example: 'Bearer' })
  tokenType!: string;

  @ApiProperty({ example: 3600, description: 'Token lifetime in seconds' })
  expiresIn!: number;

  @ApiProperty({ type: PlatformAdminProfileDto })
  admin!: PlatformAdminProfileDto;
}
