import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';
import { createApp } from './bootstrap';

type NotifHubMode = 'development' | 'staging' | 'production';

async function bootstrap(): Promise<void> {
  const app = await createApp();

  const config = app.get(ConfigService);
  // PinoLogger is a transient provider, so it must be resolved instead of get().
  const logger = await app.resolve(PinoLogger);
  logger.setContext('bootstrap');

  const mode = config.getOrThrow<NotifHubMode>('NOTIFHUB_MODE');
  const port = config.getOrThrow<number>('PORT');

  await app.listen(port);

  logger.info(
    {
      event: 'application.started',
      service: config.getOrThrow<string>('SERVICE_NAME'),
      mode,
      port,
    },
    `NotifHub is running on http://localhost:${port}`,
  );
}

void bootstrap();
