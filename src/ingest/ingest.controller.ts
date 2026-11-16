import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBadRequestResponse,
  ApiHeader,
  ApiOperation,
  ApiSecurity,
  ApiResponse,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ThrottlerGuard, Throttle } from '@nestjs/throttler';
import type { RequestWithApiKey } from '../auth/api-key/api-key.types';
import { ApiKeyGuard } from '../common/guards/api-key.guard';
import { NotifyDto } from './dto/notify.dto';
import { IngestService } from './ingest.service';

const THROTTLE_LIMIT_FALLBACK = 100;
const THROTTLE_WINDOW_SECONDS_FALLBACK = 60;

/**
 * Throttle values are resolved per request from the (validated) environment so that
 * INGEST_RATE_LIMIT_PER_KEY / INGEST_RATE_LIMIT_WINDOW_SECONDS stay configurable
 * without recompiling. The same values configure ThrottlerModule in IngestModule.
 */
function envPositiveNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  const parsed = raw === undefined ? Number.NaN : Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

@ApiTags('ingest')
@ApiSecurity('api-key')
@Controller()
@UseGuards(ApiKeyGuard, ThrottlerGuard)
@Throttle({
  default: {
    limit: () => envPositiveNumber('INGEST_RATE_LIMIT_PER_KEY', THROTTLE_LIMIT_FALLBACK),
    ttl: () =>
      envPositiveNumber(
        'INGEST_RATE_LIMIT_WINDOW_SECONDS',
        THROTTLE_WINDOW_SECONDS_FALLBACK,
      ) * 1000,
  },
})
export class IngestController {
  constructor(private readonly ingestService: IngestService) {}

  @Post('notify')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Trigger a notification',
    description:
      'Validates the request, checks idempotency, persists the notification and enqueues one BullMQ job per (recipient x channel). Providers are never called inline.',
  })
  @ApiHeader({
    name: 'X-API-Key',
    required: true,
    description: 'Service-to-service API key from the ApiKey table.',
  })
  @ApiAcceptedResponse({
    description: 'Notification accepted for asynchronous delivery',
    schema: {
      type: 'object',
      required: ['notification_id', 'status'],
      properties: {
        notification_id: { type: 'string', format: 'uuid' },
        status: { type: 'string', enum: ['accepted'], example: 'accepted' },
      },
    },
  })
  @ApiBadRequestResponse({ description: 'Invalid payload or missing topics/recipients' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid X-API-Key' })
  @ApiResponse({
    status: HttpStatus.PAYLOAD_TOO_LARGE,
    description: 'Payload exceeds INGEST_MAX_PAYLOAD_BYTES (64 KB by default)',
  })
  @ApiTooManyRequestsResponse({ description: 'Per-key ingest rate limit exceeded' })
  @ApiServiceUnavailableResponse({ description: 'Queue backend (Redis) unavailable' })
  async notify(
    @Body() dto: NotifyDto,
    @Req() request: RequestWithApiKey,
  ): Promise<{ notification_id: string; status: 'accepted' }> {
    const principal = request.apiKey;

    if (principal === undefined) {
      throw new UnauthorizedException('Invalid or missing API key');
    }

    const result = await this.ingestService.enqueue(dto, principal.tenantId);

    return {
      notification_id: result.notification_id,
      status: 'accepted',
    };
  }
}
