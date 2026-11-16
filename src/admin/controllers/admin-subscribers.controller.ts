import { Body, Controller, Get, Param, ParseEnumPipe, Put, Query, UseGuards } from '@nestjs/common';
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
import { CurrentAdmin } from '../decorators/current-admin.decorator';
import { PreferenceResponseDto, UpdatePreferenceDto } from '../dto/preference.dto';
import { AdminListQueryDto } from '../dto/list-query.dto';
import {
  AdminSubscribersService,
  type SubscriberListResult,
  type SubscriberView,
} from '../services/admin-subscribers.service';

@ApiTags('admin')
@ApiBearerAuth('admin-jwt')
@Controller('admin/subscribers')
@UseGuards(AdminJwtGuard)
export class AdminSubscribersController {
  constructor(private readonly subscribers: AdminSubscribersService) {}

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
  upsertPreference(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('externalId') externalId: string,
    @Param('channel', new ParseEnumPipe(Channel)) channel: Channel,
    @Body() dto: UpdatePreferenceDto,
  ): Promise<PreferenceResponseDto> {
    return this.subscribers.upsertPreference(admin.tenantId, externalId, channel, dto);
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
