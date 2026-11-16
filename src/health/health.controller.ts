import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOkResponse, ApiOperation, ApiServiceUnavailableResponse, ApiTags } from '@nestjs/swagger';
import {
  HealthCheck,
  HealthCheckService,
  PrismaHealthIndicator,
  type HealthCheckResult,
} from '@nestjs/terminus';
import { PrismaService } from '../prisma/prisma.service';
import { RedisHealthIndicator } from './redis.health';

const PRISMA_PING_TIMEOUT_MS = 2000;

interface LivenessResult {
  status: 'ok';
  service: string;
  uptime: number;
}

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly config: ConfigService,
    private readonly health: HealthCheckService,
    private readonly prismaHealth: PrismaHealthIndicator,
    private readonly prisma: PrismaService,
    private readonly redisHealth: RedisHealthIndicator,
  ) {}

  /** Always 200 while the process is alive. Unauthenticated. */
  @Get('live')
  @ApiOperation({ summary: 'Liveness probe' })
  @ApiOkResponse({ description: 'Process is alive' })
  live(): LivenessResult {
    return {
      status: 'ok',
      service: this.config.getOrThrow<string>('SERVICE_NAME'),
      uptime: Math.floor(process.uptime()),
    };
  }

  /** 200 only when the database and Redis are reachable. Unauthenticated. */
  @Get('ready')
  @HealthCheck()
  @ApiOperation({ summary: 'Readiness probe (database + redis)' })
  @ApiOkResponse({ description: 'All dependencies are reachable' })
  @ApiServiceUnavailableResponse({ description: 'At least one dependency is unreachable' })
  ready(): Promise<HealthCheckResult> {
    return this.health.check([
      () =>
        this.prismaHealth.pingCheck('database', this.prisma, {
          timeout: PRISMA_PING_TIMEOUT_MS,
        }),
      () => this.redisHealth.isHealthy('redis'),
    ]);
  }
}
