import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import basicAuth from 'express-basic-auth';
import { json } from 'express';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware';

type RequestWithRawBody = IncomingMessage & { rawBody?: Buffer };

export const GLOBAL_PREFIX = 'api/v1';
export const PREFIX_EXCLUDED_PATHS = [
  'health/live',
  'health/ready',
  'metrics',
  'api/docs',
  'api/docs-json',
];
export const DOCS_PATH = 'api/docs';
export const DOCS_JSON_PATH = 'api/docs-json';

function resolveCorsOrigin(corsOrigins: string): boolean | string[] {
  const trimmed = corsOrigins.trim();

  if (trimmed === '*') {
    return true;
  }

  return trimmed
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

function protectSwaggerWithBasicAuth(app: NestExpressApplication, config: ConfigService): void {
  const user = config.getOrThrow<string>('SWAGGER_BASIC_AUTH_USER');
  const password = config.getOrThrow<string>('SWAGGER_BASIC_AUTH_PASS');

  app.use(
    [`/${DOCS_PATH}`, `/${DOCS_JSON_PATH}`],
    basicAuth({
      users: { [user]: password },
      challenge: true,
      unauthorizedResponse: 'Unauthorized',
    }),
  );
}

function setupSwagger(app: NestExpressApplication): void {
  const documentConfig = new DocumentBuilder()
    .setTitle('NotifHub API')
    .setDescription(
      'General-purpose multi-channel notification service. Ingest uses X-API-Key authentication. /api/docs-json is the single source of truth for SDK generation.',
    )
    .setVersion('0.1.0')
    .addApiKey(
      {
        type: 'apiKey',
        name: 'X-API-Key',
        in: 'header',
        description: 'Service-to-service API key',
      },
      'api-key',
    )
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description:
          'End-user subscriber JWT signed with the tenant API key subscriber secret (falls back ' +
          'to SUBSCRIBER_JWT_SECRET when the tenant has none; claims: sub, tenant, exp)',
      },
      'subscriber-jwt',
    )
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Tenant admin JWT signed with ADMIN_JWT_SECRET (claims: sub, role, tenant, exp)',
      },
      'admin-jwt',
    )
    .build();

  const document = SwaggerModule.createDocument(app, documentConfig);

  SwaggerModule.setup(DOCS_PATH, app, document, {
    jsonDocumentUrl: DOCS_JSON_PATH,
    swaggerOptions: {
      persistAuthorization: true,
    },
  });
}

/**
 * Builds the configured Nest application without binding a port.
 *
 * Shared by `main.ts` (which then calls `listen`) and the e2e suite, so tests exercise the same
 * bootstrap path as production: global prefix, raw body capture for webhook signatures, CORS,
 * Swagger, validation pipe, exception filter and logging interceptor.
 */
export async function createApp(): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
    bodyParser: false,
  });

  // Route NestJS logs through pino so every line is structured JSON and carries requestId.
  app.useLogger(app.get(Logger));

  const config = app.get(ConfigService);
  const mode = config.getOrThrow<'development' | 'staging' | 'production'>('NOTIFHUB_MODE');
  const maxPayloadBytes = config.getOrThrow<number>('INGEST_MAX_PAYLOAD_BYTES');

  // Registered before the body parser and before routes so even malformed/oversized
  // bodies are logged with the same requestId.
  const requestIdMiddleware = app.get(RequestIdMiddleware);
  app.use(requestIdMiddleware.use.bind(requestIdMiddleware));

  // Body parser is disabled above so the ingest payload limit is env-driven (413 above the limit).
  // The raw body is kept for HMAC verification of provider webhooks.
  app.use(
    json({
      limit: maxPayloadBytes,
      verify: (request: IncomingMessage, _response: ServerResponse, buffer: Buffer): void => {
        (request as RequestWithRawBody).rawBody = Buffer.from(buffer);
      },
    }),
  );

  app.enableCors({
    origin: resolveCorsOrigin(config.getOrThrow<string>('CORS_ORIGINS')),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key', 'X-Request-ID'],
    exposedHeaders: ['X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset'],
  });

  app.setGlobalPrefix(GLOBAL_PREFIX, { exclude: PREFIX_EXCLUDED_PATHS });

  if (mode !== 'development') {
    protectSwaggerWithBasicAuth(app, config);
  }
  setupSwagger(app);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(app.get(HttpExceptionFilter));
  app.useGlobalInterceptors(app.get(LoggingInterceptor));

  app.enableShutdownHooks();

  return app;
}
