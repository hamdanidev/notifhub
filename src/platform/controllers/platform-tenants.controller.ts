import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { PlatformAdminGuard } from '../../auth/admin/platform-admin.guard';
import type { PlatformAdminPrincipal } from '../../auth/admin/admin.types';
import { CurrentPlatformAdmin } from '../decorators/current-platform-admin.decorator';
import {
  CreateTenantAdminDto,
  CreateTenantDto,
  ListTenantsQueryDto,
  TenantAdminDto,
  TenantDto,
  TenantListResponseDto,
  UpdateTenantAdminDto,
  UpdateTenantDto,
} from '../dto/tenant.dto';
import {
  auditContextFrom,
  type PlatformAuditActor,
} from '../services/platform-audit.service';
import { PlatformTenantAdminsService } from '../services/platform-tenant-admins.service';
import { PlatformTenantsService } from '../services/platform-tenants.service';

function actorOf(admin: PlatformAdminPrincipal): PlatformAuditActor {
  return { adminId: admin.adminId, email: admin.email };
}

/** Cross-tenant tenant management. Every mutation is audited. */
@ApiTags('platform')
@ApiBearerAuth('admin-jwt')
@Controller('platform/tenants')
@UseGuards(PlatformAdminGuard, ThrottlerGuard)
export class PlatformTenantsController {
  constructor(
    private readonly tenants: PlatformTenantsService,
    private readonly admins: PlatformTenantAdminsService,
  ) {}

  @Get()
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @ApiOperation({ summary: 'List tenants' })
  @ApiOkResponse({ type: TenantListResponseDto })
  list(@Query() query: ListTenantsQueryDto): Promise<TenantListResponseDto> {
    return this.tenants.list(query);
  }

  @Post()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({ summary: 'Create a tenant' })
  @ApiCreatedResponse({ type: TenantDto })
  create(
    @Body() dto: CreateTenantDto,
    @CurrentPlatformAdmin() admin: PlatformAdminPrincipal,
    @Req() request: Request,
  ): Promise<TenantDto> {
    return this.tenants.create(dto, actorOf(admin), auditContextFrom(request));
  }

  @Get(':id')
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @ApiOperation({ summary: 'Tenant detail' })
  @ApiOkResponse({ type: TenantDto })
  get(@Param('id') id: string): Promise<TenantDto> {
    return this.tenants.get(id);
  }

  @Patch(':id')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({ summary: 'Rename a tenant' })
  @ApiOkResponse({ type: TenantDto })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateTenantDto,
    @CurrentPlatformAdmin() admin: PlatformAdminPrincipal,
    @Req() request: Request,
  ): Promise<TenantDto> {
    return this.tenants.update(id, dto, actorOf(admin), auditContextFrom(request));
  }

  @Post(':id/suspend')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({ summary: 'Suspend a tenant (idempotent)' })
  @ApiOkResponse({ type: TenantDto })
  suspend(
    @Param('id') id: string,
    @CurrentPlatformAdmin() admin: PlatformAdminPrincipal,
    @Req() request: Request,
  ): Promise<TenantDto> {
    return this.tenants.suspend(id, actorOf(admin), auditContextFrom(request));
  }

  @Post(':id/resume')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({ summary: 'Resume a suspended tenant (idempotent)' })
  @ApiOkResponse({ type: TenantDto })
  resume(
    @Param('id') id: string,
    @CurrentPlatformAdmin() admin: PlatformAdminPrincipal,
    @Req() request: Request,
  ): Promise<TenantDto> {
    return this.tenants.resume(id, actorOf(admin), auditContextFrom(request));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({ summary: 'Delete an empty tenant (default tenant is protected)' })
  @ApiForbiddenResponse({ description: 'tenant_protected' })
  @ApiNotFoundResponse({ description: 'tenant_not_found' })
  async remove(
    @Param('id') id: string,
    @CurrentPlatformAdmin() admin: PlatformAdminPrincipal,
    @Req() request: Request,
  ): Promise<void> {
    await this.tenants.remove(id, actorOf(admin), auditContextFrom(request));
  }

  @Get(':id/admins')
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @ApiOperation({ summary: 'List tenant admins' })
  @ApiOkResponse({ type: [TenantAdminDto] })
  listAdmins(@Param('id') id: string): Promise<TenantAdminDto[]> {
    return this.admins.list(id);
  }

  @Post(':id/admins')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({ summary: 'Create a tenant admin with an initial password' })
  @ApiCreatedResponse({ type: TenantAdminDto })
  createAdmin(
    @Param('id') id: string,
    @Body() dto: CreateTenantAdminDto,
    @CurrentPlatformAdmin() admin: PlatformAdminPrincipal,
    @Req() request: Request,
  ): Promise<TenantAdminDto> {
    return this.admins.create(id, dto, actorOf(admin), auditContextFrom(request));
  }

  @Patch(':id/admins/:adminId')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({ summary: 'Reset password or (de)activate a tenant admin' })
  @ApiOkResponse({ type: TenantAdminDto })
  updateAdmin(
    @Param('id') id: string,
    @Param('adminId') adminId: string,
    @Body() dto: UpdateTenantAdminDto,
    @CurrentPlatformAdmin() admin: PlatformAdminPrincipal,
    @Req() request: Request,
  ): Promise<TenantAdminDto> {
    return this.admins.update(id, adminId, dto, actorOf(admin), auditContextFrom(request));
  }
}
