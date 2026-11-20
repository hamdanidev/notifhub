import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from '../auth/auth.module';
import { MetricsModule } from '../metrics/metrics.module';
import { QueuesModule } from '../queues/queues.module';
import { RoutingModule } from '../routing/routing.module';
import { IngestController } from './ingest.controller';
import { IngestService } from './ingest.service';

@Module({
  imports: [
    QueuesModule,
    MetricsModule,
    RoutingModule,
    AuthModule,
    // Scoped to the ingest module on purpose: no global ThrottlerModule / APP_GUARD.
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => [
        {
          name: 'default',
          ttl: config.getOrThrow<number>('INGEST_RATE_LIMIT_WINDOW_SECONDS') * 1000,
          limit: config.getOrThrow<number>('INGEST_RATE_LIMIT_PER_KEY'),
        },
      ],
    }),
  ],
  controllers: [IngestController],
  // ThrottlerGuard is a provider so its onModuleInit lifecycle hook runs.
  providers: [IngestService, ThrottlerGuard],
  exports: [IngestService],
})
export class IngestModule {}
