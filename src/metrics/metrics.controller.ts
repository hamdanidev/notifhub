import { Controller, Get, Res, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiProduces, ApiSecurity, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { ApiKeyGuard } from '../common/guards/api-key.guard';
import { MetricsService } from './metrics.service';

@ApiTags('metrics')
@ApiSecurity('api-key')
@Controller('metrics')
@UseGuards(ApiKeyGuard)
export class MetricsController {
  constructor(private readonly metricsService: MetricsService) {}

  @Get()
  @ApiOperation({ summary: 'Prometheus metrics (protected by X-API-Key)' })
  @ApiProduces('text/plain')
  async scrape(@Res({ passthrough: true }) response: Response): Promise<string> {
    // prom-client's canonical content type: text/plain; version=0.0.4; charset=utf-8
    response.setHeader('Content-Type', this.metricsService.contentType);

    return this.metricsService.metrics();
  }
}
