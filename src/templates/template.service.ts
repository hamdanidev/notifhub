import { Injectable } from '@nestjs/common';
import { Channel, type NotificationTemplate } from '@prisma/client';
import Handlebars from 'handlebars';
import { PinoLogger } from 'nestjs-pino';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

export interface RenderedTemplate {
  subject: string | null;
  body: string;
}

const MAX_COMPILED_TEMPLATES = 500;

type CompiledTemplate = ReturnType<typeof Handlebars.compile>;

/**
 * Template resolution and rendering for every channel.
 *
 * - locale fallback: requested locale -> DEFAULT_LOCALE -> template not found
 * - version selection: highest active version
 * - rendering: Handlebars (default escaping; use {{{value}}} for raw HTML)
 *
 * Compiled templates are cached by template id + updatedAt so a change to a template row
 * invalidates the cached delegate automatically.
 */
@Injectable()
export class TemplateService {
  private readonly compiled = new Map<string, CompiledTemplate>();

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
  ): Promise<NotificationTemplate | null> {
    const locales = this.localeCandidates(locale);

    for (const candidate of locales) {
      const template = await this.prisma.notificationTemplate.findFirst({
        where: {
          tenantId,
          key: templateKey,
          channel,
          locale: candidate,
          active: true,
        },
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
      'no active template found for the requested key, channel and locale chain',
    );

    return null;
  }

  /** Batch resolution for catch-up pages (avoids N+1 template queries). */
  async resolveMany(
    tenantId: string,
    templateKeys: string[],
    channel: Channel,
    locale: string | undefined,
  ): Promise<Map<string, NotificationTemplate>> {
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
      },
    });

    const selected = new Map<string, { localeRank: number; template: NotificationTemplate }>();

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
    template: Pick<NotificationTemplate, 'id' | 'subject' | 'body' | 'updatedAt'>,
    data: Record<string, unknown>,
  ): RenderedTemplate {
    return {
      subject:
        template.subject === null
          ? null
          : this.renderField(template, 'subject', template.subject, data),
      body: this.renderField(template, 'body', template.body, data),
    };
  }

  private renderField(
    template: Pick<NotificationTemplate, 'id' | 'updatedAt'>,
    field: 'subject' | 'body',
    source: string,
    data: Record<string, unknown>,
  ): string {
    const cacheKey = `${template.id}:${template.updatedAt.getTime()}:${field}`;
    const delegate = this.compile(source, cacheKey);
    const output = delegate(data);

    return typeof output === 'string' ? output : '';
  }

  private compile(source: string, cacheKey: string): CompiledTemplate {
    const cached = this.compiled.get(cacheKey);

    if (cached !== undefined) {
      return cached;
    }

    const delegate = Handlebars.compile(source);

    if (this.compiled.size >= MAX_COMPILED_TEMPLATES) {
      this.compiled.clear();
    }

    this.compiled.set(cacheKey, delegate);

    return delegate;
  }

  private localeCandidates(locale: string | undefined): string[] {
    const defaultLocale = this.config.getOrThrow<string>('DEFAULT_LOCALE');
    const values: string[] = [];
    const requested = locale?.trim();

    if (requested !== undefined && requested.length > 0) {
      values.push(requested);
    }

    if (!values.includes(defaultLocale)) {
      values.push(defaultLocale);
    }

    return values;
  }
}
