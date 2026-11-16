import { Body, Controller, Get, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ThrottlerGuard, Throttle } from '@nestjs/throttler';
import { AdminJwtGuard } from '../../auth/admin/admin-jwt.guard';
import type { AdminPrincipal } from '../../auth/admin/admin.types';
import { CurrentAdmin } from '../decorators/current-admin.decorator';
import { AdminProfileDto, LoginDto, LoginResponseDto } from '../dto/auth.dto';
import { AdminAuthService } from '../services/admin-auth.service';

@ApiTags('admin')
@Controller('admin/auth')
export class AdminAuthController {
  constructor(private readonly authService: AdminAuthService) {}

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
}
