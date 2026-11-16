import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBadRequestResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { WebhookEventDto } from './dto/webhook-event.dto';
import { WebhookSignatureService } from './webhook-signature.service';
import { WebhooksService } from './webhooks.service';

interface WebhookRequest extends Request {
  rawBody?: Buffer;
}

@ApiTags('webhooks')
@Controller('webhooks')
export class WebhooksController {
  constructor(
    private readonly signatures: WebhookSignatureService,
    private readonly webhooks: WebhooksService,
  ) {}

  @Post(':provider')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Receive provider delivery status callbacks',
    description:
      'Authenticated with an HMAC signature over the raw body. Events are appended to delivery_events and applied to the recipient with monotonic status transitions.',
  })
  @ApiParam({ name: 'provider', enum: ['smtp', 'whatsapp', 'sms'] })
  @ApiHeader({
    name: 'X-NotifHub-Signature',
    required: true,
    description: 't=<unix seconds>,v1=<hex hmac sha256 of "<timestamp>.<raw body>">',
  })
  @ApiAcceptedResponse({
    description: 'Event accepted (also returned when the notification is unknown)',
    schema: {
      type: 'object',
      required: ['status'],
      properties: { status: { type: 'string', enum: ['accepted'] } },
    },
  })
  @ApiUnauthorizedResponse({ description: 'Missing, malformed, stale or invalid signature' })
  @ApiNotFoundResponse({ description: 'Unknown webhook provider' })
  @ApiBadRequestResponse({ description: 'Invalid body or channel/provider mismatch' })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Signature verification failed' })
  async receive(
    @Param('provider') provider: string,
    @Body() dto: WebhookEventDto,
    @Req() request: WebhookRequest,
  ): Promise<{ status: 'accepted' }> {
    this.signatures.verify(
      request.rawBody,
      request.header('x-notifhub-signature'),
      request.ip ?? 'unknown',
      request.originalUrl ?? request.url,
    );

    await this.webhooks.handle(provider, dto);

    return { status: 'accepted' };
  }
}
