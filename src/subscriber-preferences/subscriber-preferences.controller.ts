import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseEnumPipe,
  Put,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiSecurity,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { Channel } from '@prisma/client';
import { SubscriberJwtGuard } from '../auth/subscriber/subscriber-jwt.guard';
import type { RequestWithSubscriber, SubscriberPrincipal } from '../auth/subscriber/subscriber.types';
import {
  ChannelPreferenceResponseDto,
  SubscriberPreferencesResponseDto,
  UpdateSubscriberPreferenceDto,
} from './dto/subscriber-preference.dto';
import { SubscriberPreferencesService } from './subscriber-preferences.service';

const RATE_LIMIT = { default: { limit: 60, ttl: 60_000 } };

/**
 * End-user self-service preferences. Subscriber JWT lane only: the tenant and the recipient are
 * taken from the verified token, never from the path, query or body.
 */
@ApiTags('subscriber-preferences')
@ApiSecurity('subscriber-jwt')
@Controller('subscriber/preferences')
@UseGuards(ThrottlerGuard, SubscriberJwtGuard)
export class SubscriberPreferencesController {
  constructor(private readonly preferences: SubscriberPreferencesService) {}

  @Get()
  @Throttle(RATE_LIMIT)
  @ApiOperation({
    summary: 'Read the notification preferences of the authenticated subscriber',
    description:
      'Always returns the three channels (inapp, email, whatsapp). A channel without a stored ' +
      'row is returned with the effective defaults and isDefault=true.',
  })
  @ApiOkResponse({ type: SubscriberPreferencesResponseDto })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid subscriber token' })
  @ApiTooManyRequestsResponse({ description: 'Rate limit exceeded (60 requests per minute)' })
  async get(@Req() request: RequestWithSubscriber): Promise<SubscriberPreferencesResponseDto> {
    return this.preferences.get(this.principal(request));
  }

  @Put(':channel')
  @HttpCode(HttpStatus.OK)
  @Throttle(RATE_LIMIT)
  @ApiOperation({
    summary: 'Replace the preference of one channel (full snapshot)',
    description:
      'Quiet hours must be sent together or omitted. When timezone is omitted it inherits the ' +
      'subscriber timezone, falling back to Asia/Jakarta.',
  })
  @ApiParam({ name: 'channel', enum: ['inapp', 'email', 'whatsapp'] })
  @ApiOkResponse({ type: ChannelPreferenceResponseDto })
  @ApiBadRequestResponse({
    description: 'Unknown channel, invalid quiet hours pair, or invalid timezone',
  })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid subscriber token' })
  @ApiTooManyRequestsResponse({ description: 'Rate limit exceeded (60 requests per minute)' })
  async upsert(
    @Req() request: RequestWithSubscriber,
    @Param('channel', new ParseEnumPipe(Channel)) channel: Channel,
    @Body() dto: UpdateSubscriberPreferenceDto,
  ): Promise<ChannelPreferenceResponseDto> {
    return this.preferences.upsert(this.principal(request), channel, dto);
  }

  private principal(request: RequestWithSubscriber): SubscriberPrincipal {
    const principal = request.subscriber;

    if (principal === undefined) {
      throw new UnauthorizedException('Invalid or missing subscriber token');
    }

    return principal;
  }
}
