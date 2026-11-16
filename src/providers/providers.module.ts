import { MailerModule } from '@nestjs-modules/mailer';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { InAppModule } from '../in-app/in-app.module';
import { EmailProvider } from './email/email.provider';
import { InAppProvider } from './in-app/in-app.provider';
import { ProviderExecutor } from './provider-executor.service';
import { ProviderRegistry } from './provider-registry.service';
import { WhatsAppProvider } from './whatsapp/whatsapp.provider';

@Module({
  imports: [
    ConfigModule,
    InAppModule,
    MailerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const user = config.get<string>('SMTP_USER');
        const pass = config.get<string>('SMTP_PASS');

        return {
          transport: {
            host: config.get<string>('SMTP_HOST') ?? 'localhost',
            port: config.get<number>('SMTP_PORT') ?? 1025,
            secure: false,
            auth:
              user !== undefined && user.length > 0
                ? { user, pass: pass ?? '' }
                : undefined,
          },
          defaults: {
            from: config.get<string>('SMTP_FROM') ?? 'noreply@notifhub.local',
          },
        };
      },
    }),
  ],
  providers: [
    InAppProvider,
    EmailProvider,
    WhatsAppProvider,
    ProviderExecutor,
    ProviderRegistry,
  ],
  exports: [ProviderExecutor, ProviderRegistry],
})
export class ProvidersModule {}
