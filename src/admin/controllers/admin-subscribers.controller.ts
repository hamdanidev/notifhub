import { Body, Controller, Get, Param, ParseEnumPipe, Put, Query, Req, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Channel } from '@prisma/client';
import { AdminJwtGuard } from '../../auth/admin/admin-jwt.guard';
import type { AdminPrincipal } from '../../auth/admin/admin.types';
import type { RequestWithId } from '../../common/middleware/request-id.middleware';
import { CurrentAdmin } from '../decorators/current-admin.decorator';
import { PreferenceResponseDto, UpdatePreferenceDto } from '../dto/preference.dto';
import { AdminListQueryDto } from '../dto/list-query.dto';
import {
  AdminSubscribersService,
  type SubscriberListResult,
  type SubscriberView,
} from '../services/admin-subscribers.service';
import { AdminAuditService, adminAuditContextFrom } from '../services/admin-audit.service';

@ApiTags('admin')
@ApiBearerAuth('admin-jwt')
@Controller('admin/subscribers')
@UseGuards(AdminJwtGuard)
export class AdminSubscribersController {
  constructor(
    private readonly subscribers: AdminSubscribersService,
    private readonly audit: AdminAuditService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List subscribers for the tenant' })
  @ApiOkResponse({ description: 'Paginated subscriber list' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid admin token' })
  list(
    @CurrentAdmin() admin: AdminPrincipal,
    @Query() query: AdminListQueryDto,
  ): Promise<SubscriberListResult> {
    return this.subscribers.list(admin.tenantId, query);
  }

  @Get(':externalId/preferences')
  @ApiOperation({ summary: 'List notification preferences for a subscriber' })
  @ApiOkResponse({ type: [PreferenceResponseDto] })
  @ApiNotFoundResponse({ description: 'Subscriber not found for this tenant' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid admin token' })
  preferences(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('externalId') externalId: string,
  ): Promise<PreferenceResponseDto[]> {
    return this.subscribers.listPreferences(admin.tenantId, externalId);
  }

  @Put(':externalId/preferences/:channel')
  @ApiOperation({ summary: 'Upsert a notification preference (full snapshot)' })
  @ApiOkResponse({ type: PreferenceResponseDto })
  @ApiNotFoundResponse({ description: 'Subscriber not found for this tenant' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid admin token' })
  async upsertPreference(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('externalId') externalId: string,
    @Param('channel', new ParseEnumPipe(Channel)) channel: Channel,
    @Body() dto: UpdatePreferenceDto,
    @Req() request: RequestWithId,
  ): Promise<PreferenceResponseDto> {
    const preference = await this.subscribers.upsertPreference(
      admin.tenantId,
      externalId,
      channel,
      dto,
    );
    await this.audit.record({
      tenantId: admin.tenantId,
      actor: { adminId: admin.adminId, email: admin.email },
      action: 'admin.subscriber.preferences_updated',
      targetType: 'subscriber',
      targetId: externalId,
      metadata: { channel, enabled: preference.enabled },
      context: adminAuditContextFrom(request),
    });
    return preference;
  }

  @Get(':externalId')
  @ApiOperation({ summary: 'Get a subscriber' })
  @ApiOkResponse({ description: 'Subscriber detail' })
  @ApiNotFoundResponse({ description: 'Subscriber not found for this tenant' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid admin token' })
  get(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('externalId') externalId: string,
  ): Promise<SubscriberView> {
    return this.subscribers.get(admin.tenantId, externalId);
  }
}
