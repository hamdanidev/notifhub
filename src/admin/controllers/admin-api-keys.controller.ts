import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Req, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { AdminJwtGuard } from '../../auth/admin/admin-jwt.guard';
import type { AdminPrincipal } from '../../auth/admin/admin.types';
import type { RequestWithId } from '../../common/middleware/request-id.middleware';
import { CurrentAdmin } from '../decorators/current-admin.decorator';
import {
  ApiKeySummaryDto,
  CreateApiKeyDto,
  CreatedApiKeyResponseDto,
  RevokedApiKeyResponseDto,
} from '../dto/api-key.dto';
import { AdminApiKeysService } from '../services/admin-api-keys.service';
import { AdminAuditService, adminAuditContextFrom } from '../services/admin-audit.service';

@ApiTags('admin')
@ApiBearerAuth('admin-jwt')
@Controller('admin/api-keys')
@UseGuards(AdminJwtGuard)
export class AdminApiKeysController {
  constructor(
    private readonly apiKeys: AdminApiKeysService,
    private readonly audit: AdminAuditService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List API keys for the tenant (raw keys are never returned)' })
  @ApiOkResponse({ type: [ApiKeySummaryDto] })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid admin token' })
  list(@CurrentAdmin() admin: AdminPrincipal): Promise<ApiKeySummaryDto[]> {
    return this.apiKeys.list(admin.tenantId);
  }

  @Post()
  @ApiOperation({ summary: 'Create an API key for the tenant' })
  @ApiCreatedResponse({ type: CreatedApiKeyResponseDto })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid admin token' })
  async create(
    @CurrentAdmin() admin: AdminPrincipal,
    @Body() dto: CreateApiKeyDto,
    @Req() request: RequestWithId,
  ): Promise<CreatedApiKeyResponseDto> {
    const created = await this.apiKeys.create(admin.tenantId, dto);
    await this.audit.record({
      tenantId: admin.tenantId,
      actor: { adminId: admin.adminId, email: admin.email },
      action: 'admin.api_key.created',
      targetType: 'api_key',
      targetId: created.id,
      metadata: { name: created.name },
      context: adminAuditContextFrom(request),
    });
    return created;
  }

  @Post(':id/revoke')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Revoke an API key (idempotent)' })
  @ApiOkResponse({ type: RevokedApiKeyResponseDto })
  @ApiNotFoundResponse({ description: 'API key not found for this tenant' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid admin token' })
  async revoke(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('id') apiKeyId: string,
    @Req() request: RequestWithId,
  ): Promise<RevokedApiKeyResponseDto> {
    const revoked = await this.apiKeys.revoke(admin.tenantId, apiKeyId);
    await this.audit.record({
      tenantId: admin.tenantId,
      actor: { adminId: admin.adminId, email: admin.email },
      action: 'admin.api_key.revoked',
      targetType: 'api_key',
      targetId: apiKeyId,
      context: adminAuditContextFrom(request),
    });
    return revoked;
  }
}
