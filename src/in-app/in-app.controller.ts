import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiSecurity,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { SubscriberJwtGuard } from '../auth/subscriber/subscriber-jwt.guard';
import type { RequestWithSubscriber, SubscriberPrincipal } from '../auth/subscriber/subscriber.types';
import {
  DEFAULT_IN_APP_PAGE_SIZE,
  InAppNotificationPage,
  ListInAppNotificationsDto,
  ReadReceiptResponse,
} from './dto/list-in-app-notifications.dto';
import { InAppService } from './in-app.service';

@ApiTags('in-app')
@ApiSecurity('subscriber-jwt')
@Controller('in-app')
@UseGuards(SubscriberJwtGuard)
export class InAppController {
  constructor(private readonly inAppService: InAppService) {}

  @Get('notifications')
  @ApiOperation({
    summary: 'List in-app notifications for the authenticated subscriber (catch-up)',
    description:
      'Returns notifications where the subscriber has an in-app recipient row, newest first. Use nextCursor for pagination.',
  })
  @ApiOkResponse({ type: InAppNotificationPage })
  @ApiBadRequestResponse({ description: 'Invalid cursor or limit' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid subscriber token' })
  async list(
    @Req() request: RequestWithSubscriber,
    @Query() query: ListInAppNotificationsDto,
  ): Promise<InAppNotificationPage> {
    return this.inAppService.list(
      this.principal(request),
      query.limit ?? DEFAULT_IN_APP_PAGE_SIZE,
      query.cursor,
    );
  }

  @Post('notifications/:notificationId/read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark an in-app notification as read (idempotent)' })
  @ApiParam({ name: 'notificationId', format: 'uuid' })
  @ApiOkResponse({ type: ReadReceiptResponse })
  @ApiNotFoundResponse({ description: 'Notification not found for this subscriber' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid subscriber token' })
  async markRead(
    @Req() request: RequestWithSubscriber,
    @Param('notificationId', new ParseUUIDPipe()) notificationId: string,
  ): Promise<ReadReceiptResponse> {
    return this.inAppService.markRead(this.principal(request), notificationId);
  }

  private principal(request: RequestWithSubscriber): SubscriberPrincipal {
    const principal = request.subscriber;

    if (principal === undefined) {
      throw new UnauthorizedException('Invalid or missing subscriber token');
    }

    return principal;
  }
}
