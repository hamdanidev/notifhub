import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { AdminJwtGuard } from '../../auth/admin/admin-jwt.guard';
import type { AdminPrincipal } from '../../auth/admin/admin.types';
import { CurrentAdmin } from '../decorators/current-admin.decorator';
import { ExportNotificationsQueryDto } from '../dto/export-notifications.dto';
import { NotificationListQueryDto } from '../dto/list-query.dto';
import { ResendNotificationDto } from '../dto/resend-notification.dto';
import {
  AdminNotificationResendService,
  type ResendNotificationResult,
} from '../services/admin-notification-resend.service';
import {
  AdminNotificationsService,
  type NotificationDetailResult,
  type NotificationExportResult,
  type NotificationListResult,
} from '../services/admin-notifications.service';

@ApiTags('admin')
@ApiBearerAuth('admin-jwt')
@Controller('admin/notifications')
@UseGuards(AdminJwtGuard)
export class AdminNotificationsController {
  constructor(
    private readonly notifications: AdminNotificationsService,
    private readonly resendService: AdminNotificationResendService,
  ) {}

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

  @Get('export')
  @ApiOperation({
    summary: 'Export filtered notifications as JSON (max 5000 rows)',
    description:
      'The console turns this response into CSV. Sorting and filters match the notification list.',
  })
  @ApiOkResponse({ description: 'Export rows with total and truncated flag' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid admin token' })
  export(
    @CurrentAdmin() admin: AdminPrincipal,
    @Query() query: ExportNotificationsQueryDto,
  ): Promise<NotificationExportResult> {
    return this.notifications.export(admin.tenantId, query);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Notification detail with payload, recipients, recent attempts and delivery events',
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

  @Post(':id/resend')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Resend failed or all non-SMS recipient/channel pairs as a new notification',
    description:
      'failed resends only failed pairs; all resends every non-SMS pair (including successful ' +
      'ones) and requires explicit console confirmation. The original notification is immutable; ' +
      'a new notification is created with an audit link and no new billing event.',
  })
  @ApiAcceptedResponse({
    description: 'Resend accepted',
    schema: {
      type: 'object',
      required: ['notification_id', 'status', 'mode', 'recipient_count', 'channels'],
      properties: {
        notification_id: { type: 'string', format: 'uuid' },
        status: { type: 'string', enum: ['accepted'] },
        mode: { type: 'string', enum: ['failed', 'all'] },
        recipient_count: { type: 'number' },
        channels: { type: 'array', items: { type: 'string' } },
      },
    },
  })
  @ApiNotFoundResponse({ description: 'Notification not found for this tenant' })
  @ApiConflictResponse({ description: 'No failed recipients or request key already used' })
  @ApiServiceUnavailableResponse({ description: 'Notification queue is unavailable' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid admin token' })
  resend(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('id', new ParseUUIDPipe()) notificationId: string,
    @Body() dto: ResendNotificationDto,
  ): Promise<ResendNotificationResult> {
    return this.resendService.resend(admin.tenantId, notificationId, dto);
  }
}
