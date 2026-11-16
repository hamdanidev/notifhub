import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Channel, TemplateFormat } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { TemplateRenderer } from '../../templates/template.render';
import type { RenderableTemplate, TemplatePreviewResult, TemplateValidationIssue } from '../../templates/template.types';
import { AdminTemplateAssetsService } from './admin-template-assets.service';
import { AdminTemplateValidationService, buildRenderable, directionFor } from './admin-template-validation.service';
import type { PreviewSavedTemplateDto, PreviewTemplateDto } from '../dto/template.dto';

const FULL_INCLUDE = {
  layout: true,
  theme: true,
  partials: { include: { partial: true } },
} as const;

@Injectable()
export class AdminTemplatePreviewService {
  private readonly renderer = new TemplateRenderer();

  constructor(
    private readonly prisma: PrismaService,
    private readonly assets: AdminTemplateAssetsService,
    private readonly validation: AdminTemplateValidationService,
    private readonly config: ConfigService,
  ) {}

  async previewSaved(
    tenantId: string,
    templateId: string,
    dto: PreviewSavedTemplateDto,
  ): Promise<TemplatePreviewResult> {
    const template = await this.prisma.notificationTemplate.findFirst({
      where: { id: templateId, tenantId },
      include: FULL_INCLUDE,
    });

    if (template === null) {
      throw new NotFoundException('Template not found');
    }

    const sampleData = dto.sampleData ?? template.sampleData;
    const renderable: RenderableTemplate = {
      ...template,
      direction: dto.direction ?? template.direction,
      sampleData,
    };

    return this.renderPreview(renderable, sampleData);
  }

  async previewInline(
    tenantId: string,
    dto: PreviewTemplateDto,
  ): Promise<TemplatePreviewResult> {
    const format = normalizePreviewFormat(dto.channel, dto.format);
    const layout = await this.assets.resolveLayout(tenantId, dto.layoutId);
    const theme = await this.assets.resolveTheme(tenantId, dto.themeId);
    const partials = await this.assets.resolvePartials(tenantId, dto.partialIds);
    const renderable = buildRenderable({
      channel: dto.channel,
      locale: dto.locale ?? this.config.get<string>('DEFAULT_LOCALE') ?? 'id',
      subject: dto.subject ?? null,
      preheader: dto.preheader ?? null,
      body: dto.body,
      format,
      direction: dto.direction ?? 'auto',
      strictVariables: dto.strictVariables ?? false,
      variables: dto.variables ?? null,
      sampleData: dto.sampleData ?? null,
      layout,
      theme,
      partials,
    });

    return this.renderPreview(renderable, dto.sampleData ?? null);
  }

  private async renderPreview(
    template: RenderableTemplate,
    sampleData: unknown,
  ): Promise<TemplatePreviewResult> {
    const startedAt = Date.now();
    const issues = this.validation.validate(template);
    const errors = issues.filter((issue) => issue.severity === 'error');
    const warnings = issues.filter((issue) => issue.severity === 'warning');
    let body = '';
    let html: string | null = null;
    let text: string | null = null;
    let missingVariables: string[] = [];
    let renderedSubject: string | null = null;
    let renderedPreheader: string | null = null;

    try {
      const rendered = this.renderer.render(
        { ...template, strictVariables: false },
        isRecord(sampleData) ? sampleData : {},
      );

      body = rendered.body;
      missingVariables = rendered.missingVariables;
      renderedSubject = rendered.subject;
      renderedPreheader = rendered.preheader;

      if (template.channel === Channel.email) {
        html = wrapPreviewDocument(body);
        text = rendered.text;
      } else {
        text = body;
      }

      if (rendered.warnings.length > 0) {
        const known = new Set(warnings.map((issue) => issue.message));

        for (const warning of rendered.warnings) {
          if (known.has(warning)) {
            continue;
          }

          warnings.push({
            code: 'render_warning',
            path: 'body',
            message: warning,
            severity: 'warning',
          });
          known.add(warning);
        }
      }
    } catch (error) {
      errors.push({
        code: 'template_render_failed',
        path: 'body',
        message: error instanceof Error ? error.message : 'template gagal dirender',
        severity: 'error',
      });
    }

    const subject =
      template.subject === null
        ? null
        : (renderedSubject ?? interpolatePreview(template.subject, template, sampleData));
    const preheader =
      template.preheader === null
        ? null
        : (renderedPreheader ?? interpolatePreview(template.preheader, template, sampleData));

    return {
      subject,
      preheader,
      body,
      html,
      text,
      format: template.format,
      warnings: dedupePreviewIssues(warnings),
      errors: dedupePreviewIssues(errors),
      missingVariables,
      resolved: {
        locale: template.locale,
        direction: directionFor(template.locale, template.direction),
        layout:
          template.layout === null
            ? null
            : {
                id: template.layout.id,
                key: template.layout.key,
                version: template.layout.version,
              },
        theme:
          template.theme === null
            ? null
            : {
                id: template.theme.id,
                key: template.theme.key,
                version: template.theme.version,
              },
        partials: template.partials.map((link) => ({
          id: link.partial.id,
          key: link.partial.key,
          version: link.partial.version,
        })),
      },
      bytes: Buffer.byteLength(html ?? text ?? body, 'utf8'),
      renderMs: Date.now() - startedAt,
    };
  }
}

function interpolatePreview(
  source: string,
  template: RenderableTemplate,
  sampleData: unknown,
): string {
  try {
    const rendered = new TemplateRenderer().render(
      {
        ...template,
        subject: source,
        preheader: null,
        body: '',
      },
      isRecord(sampleData) ? sampleData : {},
    );

    return rendered.subject ?? source;
  } catch {
    return source;
  }
}

function normalizePreviewFormat(
  channel: Channel,
  requested: TemplateFormat | undefined,
): TemplateFormat {
  const expected = channel === Channel.email ? TemplateFormat.html : TemplateFormat.text;

  if (requested !== undefined && requested !== expected) {
    throw new BadRequestException(`channel ${channel} only supports format ${expected}`);
  }

  return requested ?? expected;
}

function wrapPreviewDocument(content: string): string {
  const csp =
    "default-src 'none'; img-src https: http:; style-src 'unsafe-inline'; font-src data:; connect-src 'none'; script-src 'none'; form-action 'none'; base-uri 'none'";
  const meta = `<meta http-equiv="Content-Security-Policy" content="${csp}">`;

  if (/<head[^>]*>/i.test(content)) {
    return content.replace(/<head([^>]*)>/i, `<head$1>${meta}`);
  }

  if (/<html[^>]*>/i.test(content)) {
    return content.replace(/<html([^>]*)>/i, `<html$1><head>${meta}</head>`);
  }

  return `<!doctype html><html><head><meta charset="utf-8">${meta}<style>html,body{margin:0;padding:0}</style></head><body>${content}</body></html>`;
}

function dedupePreviewIssues(issues: TemplateValidationIssue[]): TemplateValidationIssue[] {
  const seen = new Set<string>();
  const result: TemplateValidationIssue[] = [];

  for (const issue of issues) {
    const key = `${issue.code}:${issue.path}:${issue.message}`;

    if (!seen.has(key)) {
      seen.add(key);
      result.push(issue);
    }
  }

  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
