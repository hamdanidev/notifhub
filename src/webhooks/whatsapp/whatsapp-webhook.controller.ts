import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { PinoLogger } from 'nestjs-pino';
import { WhatsAppSignatureService } from './whatsapp-signature.service';
import { WhatsAppWebhookService } from './whatsapp-webhook.service';

type RawBodyRequest = Request & { rawBody?: Buffer };

@ApiExcludeController()
@Controller('webhooks/whatsapp/events')
export class WhatsAppWebhookController {
  constructor(
    private readonly signatures: WhatsAppSignatureService,
    private readonly webhooks: WhatsAppWebhookService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(WhatsAppWebhookController.name);
  }

  /**
   * Meta subscription verification: echoes hub.challenge when hub.verify_token matches.
   */
  @Get()
  @Header('Cache-Control', 'no-store')
  verifySubscription(
    @Query('hub.mode') mode: string | undefined,
    @Query('hub.verify_token') token: string | undefined,
    @Query('hub.challenge') challenge: string | undefined,
    @Res() response: Response,
  ): void {
    if (mode !== 'subscribe') {
      throw new BadRequestException('hub.mode must be subscribe');
    }

    if (challenge === undefined || challenge.length === 0) {
      throw new BadRequestException('hub.challenge is required');
    }

    try {
      this.signatures.verifySubscriptionToken(token);
    } catch (error) {
      throw new ForbiddenException('Invalid verify token');
    }

    response.status(HttpStatus.OK).type('text/plain').send(challenge);
  }

  /**
   * Status events from Meta: X-Hub-Signature-256 over the raw body is mandatory.
   * Always 202 for authenticated payloads (including unknown wamids) so Meta does not
   * retry indefinitely.
   */
  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  async receive(
    @Req() request: RawBodyRequest,
    @Body() payload: unknown,
  ): Promise<{ status: 'accepted' }> {
    const header = request.headers['x-hub-signature-256'];
    const signature = Array.isArray(header) ? header[0] : header;

    this.signatures.verifyEventSignature(request.rawBody, signature);
    await this.webhooks.handle(payload);

    return { status: 'accepted' };
  }
}
