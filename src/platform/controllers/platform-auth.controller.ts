import { Body, Controller, Get, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { PlatformAdminGuard } from '../../auth/admin/platform-admin.guard';
import type { PlatformAdminPrincipal } from '../../auth/admin/admin.types';
import { CurrentPlatformAdmin } from '../decorators/current-platform-admin.decorator';
import {
  PlatformAdminProfileDto,
  PlatformLoginDto,
  PlatformLoginResponseDto,
} from '../dto/platform-auth.dto';
import { PlatformAuthService } from '../services/platform-auth.service';

/** Platform lane: cross-tenant operations, separate from `/api/v1/admin/*`. */
@ApiTags('platform')
@Controller('platform/auth')
export class PlatformAuthController {
  constructor(private readonly authService: PlatformAuthService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Platform admin login (5 attempts per minute per IP)' })
  @ApiOkResponse({ type: PlatformLoginResponseDto })
  @ApiUnauthorizedResponse({ description: 'Invalid email or password' })
  @ApiForbiddenResponse({ description: 'Account is not an active platform admin' })
  @ApiTooManyRequestsResponse({ description: 'Login rate limit exceeded' })
  login(@Body() dto: PlatformLoginDto): Promise<PlatformLoginResponseDto> {
    return this.authService.login(dto);
  }

  @Get('me')
  @UseGuards(PlatformAdminGuard)
  @ApiBearerAuth('admin-jwt')
  @ApiOperation({ summary: 'Current platform admin profile' })
  @ApiOkResponse({ type: PlatformAdminProfileDto })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid admin token' })
  @ApiForbiddenResponse({ description: 'Token is not a platform admin token' })
  me(@CurrentPlatformAdmin() admin: PlatformAdminPrincipal): Promise<PlatformAdminProfileDto> {
    return this.authService.me(admin.adminId);
  }
}
