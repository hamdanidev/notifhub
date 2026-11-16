import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { AdminJwtGuard } from '../../auth/admin/admin-jwt.guard';
import type { AdminPrincipal } from '../../auth/admin/admin.types';
import { CurrentAdmin } from '../decorators/current-admin.decorator';
import { NotificationListQueryDto } from '../dto/list-query.dto';
import {
  AdminNotificationsService,
  type NotificationDetailResult,
  type NotificationListResult,
} from '../services/admin-notifications.service';

@ApiTags('admin')
@ApiBearerAuth('admin-jwt')
@Controller('admin/notifications')
@UseGuards(AdminJwtGuard)
export class AdminNotificationsController {
  constructor(private readonly notifications: AdminNotificationsService) {}

  @Get()
  @ApiOperation({ summary: 'List notifications for the tenant (filter by status/template/date)' })
  @ApiOkResponse({ description: 'Paginated notification list with recipient counts' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid admin token' })
  list(
    @CurrentAdmin() admin: AdminPrincipal,
    @Query() query: NotificationListQueryDto,
  ): Promise<NotificationListResult> {
    return this.notifications.list(admin.tenantId, query);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Notification detail with recipients, recent attempts and delivery events',
  })
  @ApiOkResponse({ description: 'Notification detail' })
  @ApiNotFoundResponse({ description: 'Notification not found for this tenant' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid admin token' })
  detail(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('id', new ParseUUIDPipe()) notificationId: string,
  ): Promise<NotificationDetailResult> {
    return this.notifications.detail(admin.tenantId, notificationId);
  }
}
