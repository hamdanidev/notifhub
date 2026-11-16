import {
  Controller,
  Get,
  Headers,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiSecurity,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { SubscriberJwtGuard } from '../auth/subscriber/subscriber-jwt.guard';
import type { RequestWithSubscriber, SubscriberPrincipal } from '../auth/subscriber/subscriber.types';
import { SseConnectionRegistry } from './sse-connection-registry.service';

@ApiTags('in-app')
@ApiSecurity('subscriber-jwt')
@Controller('in-app')
@UseGuards(SubscriberJwtGuard)
export class InAppStreamController {
  constructor(private readonly registry: SseConnectionRegistry) {}

  @Get('stream')
  @ApiOperation({
    summary: 'Subscribe to in-app notifications over Server-Sent Events',
    description:
      'fetch-based SSE stream authenticated with a subscriber JWT in the Authorization header. Every event carries an id usable as Last-Event-ID to replay missed events for up to SSE_REPLAY_BUFFER_SECONDS. Heartbeat comments are sent every 15-30 seconds.',
  })
  @ApiProduces('text/event-stream')
  @ApiOkResponse({ description: 'SSE stream of in-app notification events' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid subscriber token' })
  async stream(
    @Req() request: RequestWithSubscriber,
    @Res() response: Response,
    @Headers('last-event-id') lastEventId?: string,
  ): Promise<void> {
    const principal = this.principal(request);

    await this.registry.openStream(principal, request, response, lastEventId);
  }

  private principal(request: RequestWithSubscriber): SubscriberPrincipal {
    const principal = request.subscriber;

    if (principal === undefined) {
      throw new UnauthorizedException('Invalid or missing subscriber token');
    }

    return principal;
  }
}
