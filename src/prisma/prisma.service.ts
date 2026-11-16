import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PinoLogger } from 'nestjs-pino';
import { ReadinessService } from '../common/readiness.service';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor(
    private readonly logger: PinoLogger,
    private readonly readiness: ReadinessService,
  ) {
    super();
    this.logger.setContext(PrismaService.name);
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.readiness.markReady();
    this.logger.info({ event: 'database.connected' }, 'database connection established');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
    this.logger.info({ event: 'database.disconnected' }, 'database connection closed');
  }
}
