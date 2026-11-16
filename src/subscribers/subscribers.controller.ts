import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Put,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiSecurity,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ApiKeyGuard } from '../common/guards/api-key.guard';
import type { ApiKeyPrincipal, RequestWithApiKey } from '../auth/api-key/api-key.types';
import { SubscriberResponseDto } from './dto/subscriber-response.dto';
import { UpsertSubscriberDto } from './dto/upsert-subscriber.dto';
import { SubscribersService } from './subscribers.service';

@ApiTags('subscribers')
@ApiSecurity('api-key')
@Controller('subscribers')
@UseGuards(ApiKeyGuard)
export class SubscribersController {
  constructor(private readonly subscribers: SubscribersService) {}

  @Put(':externalId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Push-sync a subscriber snapshot',
    description:
      'Idempotent upsert on (tenantId, externalId). Fields omitted from the body are cleared (full replacement); timezone falls back to Asia/Jakarta.',
  })
  @ApiParam({ name: 'externalId', description: 'Consumer-defined recipient identifier' })
  @ApiHeader({ name: 'X-API-Key', required: true })
  @ApiOkResponse({ type: SubscriberResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid externalId or body fields' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid X-API-Key' })
  async upsert(
    @Req() request: RequestWithApiKey,
    @Param('externalId') externalId: string,
    @Body() dto: UpsertSubscriberDto,
  ): Promise<SubscriberResponseDto> {
    return this.subscribers.upsert(this.principal(request).tenantId, externalId, dto);
  }

  @Get(':externalId')
  @ApiOperation({
    summary: 'Read the stored subscriber snapshot',
    description:
      'Reads data that was previously pushed by the consumer. NotifHub never pulls subscriber data from consumer systems.',
  })
  @ApiParam({ name: 'externalId', description: 'Consumer-defined recipient identifier' })
  @ApiHeader({ name: 'X-API-Key', required: true })
  @ApiOkResponse({ type: SubscriberResponseDto })
  @ApiNotFoundResponse({ description: 'Subscriber not found for the current tenant' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid X-API-Key' })
  async get(
    @Req() request: RequestWithApiKey,
    @Param('externalId') externalId: string,
  ): Promise<SubscriberResponseDto> {
    return this.subscribers.get(this.principal(request).tenantId, externalId);
  }

  private principal(request: RequestWithApiKey): ApiKeyPrincipal {
    const principal = request.apiKey;

    if (principal === undefined) {
      throw new UnauthorizedException('Invalid or missing API key');
    }

    return principal;
  }
}
