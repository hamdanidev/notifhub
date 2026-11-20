import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ThrottlerGuard, Throttle } from '@nestjs/throttler';
import type { RequestWithId } from '../../common/middleware/request-id.middleware';
import { AdminJwtGuard } from '../../auth/admin/admin-jwt.guard';
import type { AdminPrincipal } from '../../auth/admin/admin.types';
import { CurrentAdmin } from '../decorators/current-admin.decorator';
import {
  AdminProfileDto,
  ChangePasswordDto,
  LoginDto,
  LoginResponseDto,
} from '../dto/auth.dto';
import { AdminAuditService, adminAuditContextFrom } from '../services/admin-audit.service';
import { AdminAuthService } from '../services/admin-auth.service';

@ApiTags('admin')
@Controller('admin/auth')
export class AdminAuthController {
  constructor(
    private readonly authService: AdminAuthService,
    private readonly audit: AdminAuditService,
  ) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Admin login (email + password, 5 attempts per minute per IP)' })
  @ApiOkResponse({ type: LoginResponseDto })
  @ApiUnauthorizedResponse({ description: 'Invalid email or password' })
  @ApiTooManyRequestsResponse({ description: 'Login rate limit exceeded' })
  login(@Body() dto: LoginDto): Promise<LoginResponseDto> {
    return this.authService.login(dto);
  }

  @Get('me')
  @UseGuards(AdminJwtGuard)
  @ApiBearerAuth('admin-jwt')
  @ApiOperation({ summary: 'Current admin profile' })
  @ApiOkResponse({ type: AdminProfileDto })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid admin token' })
  me(@CurrentAdmin() admin: AdminPrincipal): Promise<AdminProfileDto> {
    return this.authService.me(admin.adminId);
  }

  @Post('change-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(AdminJwtGuard, ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiBearerAuth('admin-jwt')
  @ApiOperation({
    summary: 'Change the current admin password (invalidates every existing admin session)',
  })
  @ApiNoContentResponse({ description: 'Password changed; log in again with the new password' })
  @ApiBadRequestResponse({
    description: 'invalid_current_password | password_unchanged | password_too_long',
  })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid admin token' })
  @ApiTooManyRequestsResponse({ description: 'Password change rate limit exceeded' })
  async changePassword(
    @Body() dto: ChangePasswordDto,
    @CurrentAdmin() admin: AdminPrincipal,
    @Req() request: RequestWithId,
  ): Promise<void> {
    await this.authService.changePassword(admin.adminId, dto, {
      ip: request.ip,
      requestId: request.requestId,
    });
    await this.audit.record({
      tenantId: admin.tenantId,
      actor: { adminId: admin.adminId, email: admin.email },
      action: 'admin.password.changed',
      targetType: 'admin',
      targetId: admin.adminId,
      context: adminAuditContextFrom(request),
    });
  }
}
