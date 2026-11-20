import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request } from 'express';
import { PinoLogger } from 'nestjs-pino';
import { WahaSignatureService } from './waha-signature.service';
import { WahaWebhookService } from './waha-webhook.service';

type RawBodyRequest = Request & { rawBody?: Buffer };

/**
 * WAHA status webhook. Signature (`X-Webhook-Hmac`, HMAC-SHA512 over the raw body) is mandatory.
 * Always `202` for authenticated payloads, including unknown message ids, so WAHA does not retry
 * indefinitely.
 */
@ApiExcludeController()
@Controller('webhooks/waha/events')
export class WahaWebhookController {
  constructor(
    private readonly signatures: WahaSignatureService,
    private readonly webhooks: WahaWebhookService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(WahaWebhookController.name);
  }

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  async receive(
    @Req() request: RawBodyRequest,
    @Body() payload: unknown,
  ): Promise<{ status: 'accepted' }> {
    this.signatures.verify(
      request.rawBody,
      headerValue(request, 'x-webhook-hmac'),
      headerValue(request, 'x-webhook-hmac-algorithm'),
    );
    await this.webhooks.handle(payload);

    return { status: 'accepted' };
  }
}

function headerValue(request: Request, name: string): string | undefined {
  const value = request.headers[name];

  return Array.isArray(value) ? value[0] : value;
}
