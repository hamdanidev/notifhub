import { Injectable } from '@nestjs/common';
import {
  Channel,
  TemplateStatus,
  type NotificationTemplate,
} from '@prisma/client';
import { PinoLogger } from 'nestjs-pino';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { TemplateRenderer, localeCandidates } from './template.render';
import { TemplateRenderError, type RenderableTemplate, type RenderedTemplate, type TemplateWithAssets } from './template.types';

const TEMPLATE_INCLUDE = {
  layout: true,
  theme: true,
  partials: { include: { partial: true } },
} as const;

const TEXT_LIMITS: Partial<Record<Channel, number>> = {
  inapp: 10_000,
  whatsapp: 4_096,
  sms: 1_600,
};

/**
 * Template resolution and rendering for every channel.
 *
 * - locale fallback: requested locale -> language part -> DEFAULT_LOCALE
 * - version selection: highest published + active version
 * - escaping: HTML for email, plain text for in-app/WhatsApp/SMS
 * - layout/theme/partial are immutable assets referenced by the template version
 */
@Injectable()
export class TemplateService {
  private readonly renderer = new TemplateRenderer();

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(TemplateService.name);
  }

  async resolve(
    tenantId: string,
    templateKey: string,
    channel: Channel,
    locale: string | undefined,
  ): Promise<TemplateWithAssets | null> {
    const locales = this.localeCandidates(locale);

    for (const candidate of locales) {
      const template = await this.prisma.notificationTemplate.findFirst({
        where: {
          tenantId,
          key: templateKey,
          channel,
          locale: candidate,
          active: true,
          status: TemplateStatus.published,
        },
        include: TEMPLATE_INCLUDE,
        orderBy: { version: 'desc' },
      });

      if (template !== null) {
        return template;
      }
    }

    this.logger.warn(
      {
        event: 'template.not_found',
        tenant_id: tenantId,
        template_key: templateKey,
        channel,
        locales,
      },
      'no published active template found for the requested key, channel and locale chain',
    );

    return null;
  }

  /** Batch resolution for catch-up pages (avoids N+1 template queries). */
  async resolveMany(
    tenantId: string,
    templateKeys: string[],
    channel: Channel,
    locale: string | undefined,
  ): Promise<Map<string, TemplateWithAssets>> {
    const keys = [...new Set(templateKeys)];

    if (keys.length === 0) {
      return new Map();
    }

    const candidates = this.localeCandidates(locale);
    const rows = await this.prisma.notificationTemplate.findMany({
      where: {
        tenantId,
        key: { in: keys },
        channel,
        locale: { in: candidates },
        active: true,
        status: TemplateStatus.published,
      },
      include: TEMPLATE_INCLUDE,
    });

    const selected = new Map<
      string,
      { localeRank: number; template: TemplateWithAssets }
    >();

    for (const row of rows) {
      const localeRank = candidates.indexOf(row.locale);
      const current = selected.get(row.key);

      if (
        current === undefined ||
        localeRank < current.localeRank ||
        (localeRank === current.localeRank && row.version > current.template.version)
      ) {
        selected.set(row.key, { localeRank, template: row });
      }
    }

    return new Map([...selected].map(([key, value]) => [key, value.template]));
  }

  render(
    template: RenderableTemplate,
    data: Record<string, unknown>,
  ): RenderedTemplate {
    const rendered = this.renderer.render(template, data);
    const limit = TEXT_LIMITS[template.channel];

    if (limit !== undefined && [...rendered.body].length > limit) {
      throw new TemplateRenderError(
        'template_too_large',
        `rendered ${template.channel} body melebihi ${limit} karakter`,
      );
    }

    return rendered;
  }

  private localeCandidates(locale: string | undefined): string[] {
    const defaultLocale = this.config.getOrThrow<string>('DEFAULT_LOCALE');

    return localeCandidates(locale, defaultLocale);
  }
}
