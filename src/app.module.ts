import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { TerminusModule } from '@nestjs/terminus';
import type { IncomingMessage } from 'node:http';
import { randomUUID } from 'node:crypto';
import { LoggerModule, type Params } from 'nestjs-pino';
import { AdminModule } from './admin/admin.module';
import { AuthModule } from './auth/auth.module';
import { CleanupModule } from './cleanup/cleanup.module';
import { validateEnv } from './config/env.schema';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware';
import { ReadinessModule } from './common/readiness.module';
import { RequestContext } from './common/request-context';
import { HealthModule } from './health/health.module';
import { InAppModule } from './in-app/in-app.module';
import { IngestModule } from './ingest/ingest.module';
import { MetricsModule } from './metrics/metrics.module';
import { NotificationsModule } from './notifications/notifications.module';
import { PreferencesModule } from './preferences/preferences.module';
import { PrismaModule } from './prisma/prisma.module';
import { ProvidersModule } from './providers/providers.module';
import { QueuesModule } from './queues/queues.module';
import { SubscribersModule } from './subscribers/subscribers.module';
import { SubscriberPreferencesModule } from './subscriber-preferences/subscriber-preferences.module';
import { TemplateImagesModule } from './template-images/template-images.module';
import { TopicsModule } from './topics/topics.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { WhatsAppWebhookModule } from './webhooks/whatsapp/whatsapp-webhook.module';
import { WorkersModule } from './workers/workers.module';

function resolveHeaderRequestId(request: IncomingMessage): string {
  const header = request.headers['x-request-id'];
  const raw = Array.isArray(header) ? header[0] : header;
  const trimmed = typeof raw === 'string' ? raw.trim() : '';

  return trimmed.length > 0 && trimmed.length <= 128 ? trimmed : randomUUID();
}

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnv,
      // Tests set every variable explicitly; loading a developer .env would make them non-hermetic.
      ignoreEnvFile: process.env.NODE_ENV === 'test',
    }),
    LoggerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService): Params => {
        const nodeEnv = config.getOrThrow<string>('NODE_ENV');
        const isProduction = nodeEnv === 'production';

        return {
          pinoHttp: {
            level: config.getOrThrow<string>('LOG_LEVEL'),
            // Keep the pino-http request id aligned with the AsyncLocalStorage requestId.
            genReqId: (request: IncomingMessage): string => {
              const enhanced = request as IncomingMessage & {
                id?: string;
                requestId?: string;
              };

              if (typeof enhanced.requestId === 'string' && enhanced.requestId.length > 0) {
                return enhanced.requestId;
              }
              if (typeof enhanced.id === 'string' && enhanced.id.length > 0) {
                return enhanced.id;
              }

              return resolveHeaderRequestId(request);
            },
            // requestId is attached to every log line, including logs made by services.
            mixin: () => ({ requestId: RequestContext.getRequestId() }),
            autoLogging: {
              ignore: (request: IncomingMessage): boolean => {
                const path = request.url ?? '';
                return path.startsWith('/health') || path.startsWith('/metrics');
              },
            },
            redact: {
              paths: ['req.headers["x-api-key"]', 'req.headers.authorization'],
              censor: '[redacted]',
            },
            transport: isProduction
              ? undefined
              : {
                  target: 'pino-pretty',
                  options: {
                    singleLine: true,
                    colorize: true,
                    translateTime: 'SYS:standard',
                    ignore: 'pid,hostname',
                  },
                },
          },
        };
      },
    }),
    ReadinessModule,
    PrismaModule,
    QueuesModule,
    AuthModule,
    InAppModule,
    ProvidersModule,
    PreferencesModule,
    SubscribersModule,
    SubscriberPreferencesModule,
    TopicsModule,
    WebhooksModule,
    WhatsAppWebhookModule,
    NotificationsModule,
    CleanupModule,
    TemplateImagesModule,
    AdminModule,
    WorkersModule,
    IngestModule,
    MetricsModule,
    TerminusModule,
    HealthModule,
    ScheduleModule.forRoot(),
  ],
  providers: [HttpExceptionFilter, LoggingInterceptor, RequestIdMiddleware],
})
export class AppModule {}
