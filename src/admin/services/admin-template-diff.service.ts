import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Channel, TemplateStatus } from '@prisma/client';
import { PinoLogger } from 'nestjs-pino';
import { PrismaService } from '../../prisma/prisma.service';
import { parseBuilderDocument } from '../../templates/template.builder';
import {
  diffBlocks,
  diffLines,
  diffWords,
  type BlockDiff,
  type DiffHunk,
  type LineDiff,
  type WordDiff,
} from '../../templates/template.diff';
import { AdminTemplatePreviewService } from './admin-template-preview.service';

const MAX_FIELD_HUNKS = 100;
const MAX_HUNK_CHARS = 4_000;
const MAX_RENDER_BYTES = 262_144;

export interface TemplateDiffVersion {
  id: string;
  version: number;
  revision: number;
  status: TemplateStatus;
  updatedAt: string;
  builderAvailable: boolean;
}

export interface TemplateDiffField {
  field: 'subject' | 'preheader' | 'body';
  changed: boolean;
  mode: 'word' | 'line';
  hunks: DiffHunk[];
  addedLines?: number;
  removedLines?: number;
  truncated: boolean;
}

export interface TemplateDiffRendered {
  html: string | null;
  text: string | null;
  bytes: number;
  error: string | null;
}

export interface TemplateDiffResult {
  templateId: string;
  key: string;
  channel: Channel;
  locale: string;
  from: TemplateDiffVersion;
  to: TemplateDiffVersion;
  fields: TemplateDiffField[];
  blocks: BlockDiff;
  rendered: { from: TemplateDiffRendered; to: TemplateDiffRendered };
  truncated: boolean;
}

@Injectable()
export class AdminTemplateDiffService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly preview: AdminTemplatePreviewService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(AdminTemplateDiffService.name);
  }

  async diff(
    tenantId: string,
    templateId: string,
    fromVersion?: number,
    toVersion?: number,
  ): Promise<TemplateDiffResult> {
    const target = await this.prisma.notificationTemplate.findFirst({
      where: { id: templateId, tenantId },
      select: { id: true, key: true, channel: true, locale: true, version: true },
    });

    if (target === null) {
      throw new NotFoundException('Template not found');
    }

    const to = await this.resolveVersion(tenantId, target, toVersion ?? target.version);
    const from =
      fromVersion === undefined
        ? await this.previousVersion(tenantId, target, to.version)
        : await this.resolveVersion(tenantId, target, fromVersion);

    if (from === null) {
      throw new NotFoundException('Versi sebelumnya tidak ditemukan');
    }

    if (from.id === to.id) {
      throw new BadRequestException({
        message: 'Versi pembanding harus berbeda.',
        details: { code: 'diff_same_version' },
      });
    }

    const fromBuilder = parseBuilderDocument(from.channel, from.builderData).document;
    const toBuilder = parseBuilderDocument(to.channel, to.builderData).document;
    const fields = [
      fieldDiff('subject', from.subject ?? '', to.subject ?? '', 'word'),
      fieldDiff('preheader', from.preheader ?? '', to.preheader ?? '', 'word'),
      fieldDiff('body', from.body, to.body, 'line'),
    ];

    const [fromRendered, toRendered] = await Promise.all([
      this.render(tenantId, from.id),
      this.render(tenantId, to.id),
    ]);

    const result: TemplateDiffResult = {
      templateId,
      key: target.key,
      channel: target.channel,
      locale: target.locale,
      from: versionView(from, fromBuilder !== null),
      to: versionView(to, toBuilder !== null),
      fields,
      blocks: diffBlocks(fromBuilder, toBuilder),
      rendered: { from: fromRendered, to: toRendered },
      truncated: fields.some((field) => field.truncated),
    };

    this.logger.info(
      {
        event: 'template.diff.rendered',
        tenant_id: tenantId,
        template_id: templateId,
        from_version: from.version,
        to_version: to.version,
        truncated: result.truncated,
      },
      'template diff generated',
    );

    return result;
  }

  private async resolveVersion(
    tenantId: string,
    target: { key: string; channel: Channel; locale: string },
    version: number,
  ): Promise<VersionRow> {
    const row = await this.prisma.notificationTemplate.findFirst({
      where: {
        tenantId,
        key: target.key,
        channel: target.channel,
        locale: target.locale,
        version,
      },
    });

    if (row === null) {
      throw new NotFoundException('Versi template tidak ditemukan pada grup ini');
    }

    return row;
  }

  private async previousVersion(
    tenantId: string,
    target: { key: string; channel: Channel; locale: string },
    beforeVersion: number,
  ): Promise<VersionRow | null> {
    return this.prisma.notificationTemplate.findFirst({
      where: {
        tenantId,
        key: target.key,
        channel: target.channel,
        locale: target.locale,
        version: { lt: beforeVersion },
      },
      orderBy: { version: 'desc' },
    });
  }

  private async render(tenantId: string, id: string): Promise<TemplateDiffRendered> {
    try {
      const result = await this.preview.previewSaved(tenantId, id, {});

      return {
        html: truncateHtml(result.html),
        text: result.text,
        bytes: result.bytes,
        error: null,
      };
    } catch (error) {
      return {
        html: null,
        text: null,
        bytes: 0,
        error:
          error instanceof Error
            ? error.message.slice(0, 300)
            : 'Render tidak tersedia untuk versi ini',
      };
    }
  }
}

interface VersionRow {
  id: string;
  tenantId: string;
  key: string;
  channel: Channel;
  locale: string;
  subject: string | null;
  preheader: string | null;
  body: string;
  format: string;
  version: number;
  revision: number;
  status: TemplateStatus;
  builderData: unknown;
  updatedAt: Date;
}

function versionView(row: VersionRow, builderAvailable: boolean): TemplateDiffVersion {
  return {
    id: row.id,
    version: row.version,
    revision: row.revision,
    status: row.status,
    updatedAt: row.updatedAt.toISOString(),
    builderAvailable,
  };
}

function fieldDiff(
  field: 'subject' | 'preheader' | 'body',
  before: string,
  after: string,
  mode: 'word' | 'line',
): TemplateDiffField {
  if (before === after) {
    return { field, changed: false, mode, hunks: [], truncated: false };
  }

  const result: WordDiff | LineDiff = mode === 'word' ? diffWords(before, after) : diffLines(before, after);
  const hunks = result.hunks.slice(0, MAX_FIELD_HUNKS).map((hunk) => ({
    type: hunk.type,
    value: hunk.value.length > MAX_HUNK_CHARS ? `${hunk.value.slice(0, MAX_HUNK_CHARS)}…` : hunk.value,
  }));

  return {
    field,
    changed: true,
    mode,
    hunks,
    ...(mode === 'line'
      ? { addedLines: (result as LineDiff).addedLines, removedLines: (result as LineDiff).removedLines }
      : {}),
    truncated: result.truncated || result.hunks.length > MAX_FIELD_HUNKS,
  };
}

function truncateHtml(html: string | null): string | null {
  if (html === null || Buffer.byteLength(html, 'utf8') <= MAX_RENDER_BYTES) {
    return html;
  }

  return `<p>Render dipotong karena melebihi ${MAX_RENDER_BYTES} byte.</p>`;
}
