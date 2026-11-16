import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, UseGuards } from '@nestjs/common';
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
import { CurrentAdmin } from '../decorators/current-admin.decorator';
import {
  ApiKeySummaryDto,
  CreateApiKeyDto,
  CreatedApiKeyResponseDto,
  RevokedApiKeyResponseDto,
} from '../dto/api-key.dto';
import { AdminApiKeysService } from '../services/admin-api-keys.service';

@ApiTags('admin')
@ApiBearerAuth('admin-jwt')
@Controller('admin/api-keys')
@UseGuards(AdminJwtGuard)
export class AdminApiKeysController {
  constructor(private readonly apiKeys: AdminApiKeysService) {}

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
  create(
    @CurrentAdmin() admin: AdminPrincipal,
    @Body() dto: CreateApiKeyDto,
  ): Promise<CreatedApiKeyResponseDto> {
    return this.apiKeys.create(admin.tenantId, dto);
  }

  @Post(':id/revoke')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Revoke an API key (idempotent)' })
  @ApiOkResponse({ type: RevokedApiKeyResponseDto })
  @ApiNotFoundResponse({ description: 'API key not found for this tenant' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid admin token' })
  revoke(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('id') apiKeyId: string,
  ): Promise<RevokedApiKeyResponseDto> {
    return this.apiKeys.revoke(admin.tenantId, apiKeyId);
  }
}
