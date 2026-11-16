import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  Channel,
  Prisma,
  TemplateFormat,
  TemplateStatus,
  type NotificationTemplate,
} from '@prisma/client';
import { PinoLogger } from 'nestjs-pino';
import { PrismaService } from '../../prisma/prisma.service';
import type { AdminPrincipal } from '../../auth/admin/admin.types';
import type { TemplateWithAssets, TemplateValidationIssue } from '../../templates/template.types';
import {
  buildRenderable,
  AdminTemplateValidationService,
} from './admin-template-validation.service';
import { AdminTemplateAssetsService } from './admin-template-assets.service';
import type {
  CloneTemplateDto,
  CreateTemplateDto,
  PublishTemplateDto,
  RollbackTemplateDto,
  TemplateAuditQueryDto,
  TemplateListQueryDto,
  UpdateTemplateDto,
} from '../dto/template.dto';

const META_INCLUDE = {
  layout: true,
  theme: true,
  partials: { select: { partialId: true } },
} as const;

const FULL_INCLUDE = {
  layout: true,
  theme: true,
  partials: { include: { partial: true } },
} as const;

type TemplateMeta = Prisma.NotificationTemplateGetPayload<{ include: typeof META_INCLUDE }>;

export interface TemplateView {
  id: string;
  tenantId: string;
  key: string;
  channel: Channel;
  locale: string;
  subject: string | null;
  preheader: string | null;
  body: string | null;
  bodyPreview: string;
  format: TemplateFormat;
  direction: string;
  version: number;
  revision: number;
  status: TemplateStatus;
  active: boolean;
  strictVariables: boolean;
  variables: unknown;
  sampleData: unknown;
  layoutId: string | null;
  themeId: string | null;
  partialIds: string[];
  layout: { id: string; key: string; version: number; name: string } | null;
  theme: { id: string; key: string; version: number; name: string } | null;
  fallbackProvider: string | null;
  fallbackChannel: Channel | null;
  publishedAt: string | null;
  publishedByAdminId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TemplateMutationView extends TemplateView {
  validation: TemplateValidationIssue[];
}

export interface TemplateListResult {
  items: TemplateView[];
  total: number;
  limit: number;
  offset: number;
}

export interface TemplateAuditView {
  id: string;
  action: string;
  templateVersion: number;
  actorAdminId: string | null;
  actorEmail: string | null;
  note: string | null;
  metadata: unknown;
  createdAt: string;
}

export interface TemplateTestSendView {
  id: string;
  templateVersion: number;
  channel: Channel;
  recipientMasked: string;
  status: string;
  providerName: string | null;
  providerMessageId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  requestedByAdminId: string | null;
  createdAt: string;
}

@Injectable()
export class AdminTemplatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly assets: AdminTemplateAssetsService,
    private readonly validation: AdminTemplateValidationService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(AdminTemplatesService.name);
  }

  async list(tenantId: string, query: TemplateListQueryDto): Promise<TemplateListResult> {
    const limit = query.limit ?? 20;
    const offset = query.offset ?? 0;

    const where: Prisma.NotificationTemplateWhereInput = {
      tenantId,
      ...(query.channel === undefined ? {} : { channel: query.channel }),
      ...(query.locale === undefined ? {} : { locale: query.locale }),
      ...(query.active === undefined ? {} : { active: query.active }),
      ...(query.status === undefined ? {} : { status: query.status }),
      ...(query.format === undefined ? {} : { format: query.format }),
      ...(query.search === undefined
        ? {}
        : { key: { contains: query.search, mode: 'insensitive' } }),
    };

    const [rows, total] = await Promise.all([
      this.prisma.notificationTemplate.findMany({
        where,
        include: META_INCLUDE,
        orderBy: [
          { key: 'asc' },
          { channel: 'asc' },
          { locale: 'asc' },
          { version: 'desc' },
        ],
        skip: offset,
        take: limit,
      }),
      this.prisma.notificationTemplate.count({ where }),
    ]);

    return {
      items: rows.map((row) => toTemplateView(row, query.view !== 'summary')),
      total,
      limit,
      offset,
    };
  }

  async get(tenantId: string, templateId: string): Promise<TemplateView> {
    const template = await this.prisma.notificationTemplate.findFirst({
      where: { id: templateId, tenantId },
      include: META_INCLUDE,
    });

    if (template === null) {
      throw new NotFoundException('Template not found');
    }

    return toTemplateView(template, true);
  }

  async getRenderable(tenantId: string, templateId: string): Promise<TemplateWithAssets> {
    const template = await this.prisma.notificationTemplate.findFirst({
      where: { id: templateId, tenantId },
      include: FULL_INCLUDE,
    });

    if (template === null) {
      throw new NotFoundException('Template not found');
    }

    return template;
  }

  async create(
    tenantId: string,
    admin: AdminPrincipal,
    dto: CreateTemplateDto,
  ): Promise<TemplateMutationView> {
    const status = dto.status ?? TemplateStatus.published;
    const legacy = dto.status === undefined;
    const format = normalizeFormat(dto.channel, dto.format);
    const layout = await this.assets.resolveLayout(tenantId, dto.layoutId);
    const theme = await this.assets.resolveTheme(tenantId, dto.themeId);
    const partials = await this.assets.resolvePartials(tenantId, dto.partialIds);

    const renderable = buildRenderable({
      channel: dto.channel,
      locale: dto.locale,
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
    const validation = this.validation.validate(renderable, { legacySubject: legacy });

    if (status === TemplateStatus.published) {
      this.throwIfErrors(validation);
    }

    const version =
      dto.version ?? (status === TemplateStatus.draft ? await this.nextVersion(tenantId, dto) : 1);
    const active = status === TemplateStatus.draft ? false : (dto.active ?? true);
    const now = new Date();

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        if (status === TemplateStatus.published) {
          await this.deactivateOthers(
            tx,
            tenantId,
            dto.key,
            dto.channel,
            dto.locale,
            undefined,
          );
        }

        const row = await tx.notificationTemplate.create({
          data: {
            tenantId,
            key: dto.key,
            channel: dto.channel,
            locale: dto.locale,
            subject: dto.subject ?? null,
            preheader: dto.preheader ?? null,
            body: dto.body,
            format,
            direction: dto.direction ?? 'auto',
            version,
            revision: 0,
            status,
            active,
            strictVariables: dto.strictVariables ?? false,
            variables: jsonInput(dto.variables),
            sampleData: jsonInput(dto.sampleData),
            layoutId: layout?.id ?? null,
            themeId: theme?.id ?? null,
            fallbackProvider: dto.fallbackProvider ?? null,
            fallbackChannel: dto.fallbackChannel ?? null,
            publishedAt: status === TemplateStatus.published ? now : null,
            publishedByAdminId: status === TemplateStatus.published ? admin.adminId : null,
            partials: {
              create: partials.map((link) => ({ partialId: link.partial.id })),
            },
          },
          include: META_INCLUDE,
        });

        await this.recordAudit(tx, {
          tenantId,
          templateId: row.id,
          templateVersion: row.version,
          action: 'created',
          admin,
          note: dto.note,
          metadata: { status, format, channel: dto.channel },
        });

        if (status === TemplateStatus.published) {
          await this.recordAudit(tx, {
            tenantId,
            templateId: row.id,
            templateVersion: row.version,
            action: 'published',
            admin,
            note: dto.note,
            metadata: { legacyCreate: legacy, format },
          });
        }

        return row;
      });

      this.logger.info(
        {
          event: 'admin.template.created',
          tenant_id: tenantId,
          template_id: created.id,
          key: created.key,
          channel: created.channel,
          locale: created.locale,
          version: created.version,
          status: created.status,
        },
        'template created',
      );

      return { ...toTemplateView(created, true), validation };
    } catch (error) {
      throw mapUniqueError(error);
    }
  }

  async update(
    tenantId: string,
    admin: AdminPrincipal,
    templateId: string,
    dto: UpdateTemplateDto,
  ): Promise<TemplateMutationView> {
    const existing = await this.getRenderableOrNull(tenantId, templateId);

    if (existing === null) {
      throw new NotFoundException('Template not found');
    }

    if (dto.expectedRevision !== undefined && dto.expectedRevision !== existing.revision) {
      throw new ConflictException(
        `template revision changed (expected ${dto.expectedRevision}, current ${existing.revision})`,
      );
    }

    const contentChanged = hasContentChanges(dto, existing);

    if (existing.status === TemplateStatus.published && contentChanged) {
      return this.updatePublishedViaNewVersion(tenantId, admin, existing, dto);
    }

    if (existing.status === TemplateStatus.draft) {
      return this.updateDraft(tenantId, admin, existing, dto);
    }

    return this.updatePublishedMetadata(tenantId, admin, existing, dto);
  }

  async deactivate(
    tenantId: string,
    admin: AdminPrincipal,
    templateId: string,
  ): Promise<TemplateView> {
    const existing = await this.prisma.notificationTemplate.findFirst({
      where: { id: templateId, tenantId },
      include: META_INCLUDE,
    });

    if (existing === null) {
      throw new NotFoundException('Template not found');
    }

    const template = await this.prisma.$transaction(async (tx) => {
      const row = await tx.notificationTemplate.update({
        where: { id: templateId },
        data: { active: false, revision: { increment: 1 } },
        include: META_INCLUDE,
      });

      await this.recordAudit(tx, {
        tenantId,
        templateId,
        templateVersion: row.version,
        action: 'deactivated',
        admin,
      });

      return row;
    });

    return toTemplateView(template, true);
  }

  async activate(
    tenantId: string,
    admin: AdminPrincipal,
    templateId: string,
  ): Promise<TemplateView> {
    const existing = await this.prisma.notificationTemplate.findFirst({
      where: { id: templateId, tenantId },
      include: META_INCLUDE,
    });

    if (existing === null) {
      throw new NotFoundException('Template not found');
    }

    if (existing.status !== TemplateStatus.published) {
      throw new ConflictException('only published templates can be activated');
    }

    const latest = await this.prisma.notificationTemplate.findFirst({
      where: {
        tenantId,
        key: existing.key,
        channel: existing.channel,
        locale: existing.locale,
        status: TemplateStatus.published,
      },
      orderBy: { version: 'desc' },
      select: { id: true },
    });

    if (latest?.id !== existing.id) {
      throw new ConflictException(
        'only the highest published version can be activated; use rollback to create a new version',
      );
    }

    const template = await this.prisma.$transaction(async (tx) => {
      await this.deactivateOthers(
        tx,
        tenantId,
        existing.key,
        existing.channel,
        existing.locale,
        existing.id,
      );

      const row = await tx.notificationTemplate.update({
        where: { id: templateId },
        data: { active: true, revision: { increment: 1 } },
        include: META_INCLUDE,
      });

      await this.recordAudit(tx, {
        tenantId,
        templateId,
        templateVersion: row.version,
        action: 'activated',
        admin,
      });

      return row;
    });

    return toTemplateView(template, true);
  }

  async publish(
    tenantId: string,
    admin: AdminPrincipal,
    templateId: string,
    dto: PublishTemplateDto,
  ): Promise<TemplateMutationView> {
    const existing = await this.getRenderableOrNull(tenantId, templateId);

    if (existing === null) {
      throw new NotFoundException('Template not found');
    }

    if (existing.status !== TemplateStatus.draft) {
      throw new ConflictException('only drafts can be published');
    }

    if (existing.revision !== dto.expectedRevision) {
      throw new ConflictException(
        `template revision changed (expected ${dto.expectedRevision}, current ${existing.revision})`,
      );
    }

    const latestPublished = await this.prisma.notificationTemplate.findFirst({
      where: {
        tenantId,
        key: existing.key,
        channel: existing.channel,
        locale: existing.locale,
        status: TemplateStatus.published,
      },
      orderBy: { version: 'desc' },
      select: { id: true, version: true },
    });

    if (latestPublished !== null && existing.version <= latestPublished.version) {
      throw new ConflictException(
        'draft version must be newer than the latest published version; use rollback to create a new version',
      );
    }

    const validation = this.validation.validate(existing);
    this.throwIfErrors(validation);

    const published = await this.prisma.$transaction(async (tx) => {
      await this.deactivateOthers(
        tx,
        tenantId,
        existing.key,
        existing.channel,
        existing.locale,
        existing.id,
      );

      const row = await tx.notificationTemplate.update({
        where: { id: existing.id },
        data: {
          status: TemplateStatus.published,
          active: true,
          publishedAt: new Date(),
          publishedByAdminId: admin.adminId,
          revision: { increment: 1 },
        },
        include: META_INCLUDE,
      });

      await this.recordAudit(tx, {
        tenantId,
        templateId: existing.id,
        templateVersion: row.version,
        action: 'published',
        admin,
        note: dto.note,
        metadata: { validationErrors: 0 },
      });

      return row;
    });

    this.logger.info(
      {
        event: 'admin.template.published',
        tenant_id: tenantId,
        template_id: published.id,
        key: published.key,
        channel: published.channel,
        locale: published.locale,
        version: published.version,
      },
      'template published',
    );

    return { ...toTemplateView(published, true), validation };
  }

  async clone(
    tenantId: string,
    admin: AdminPrincipal,
    templateId: string,
    dto: CloneTemplateDto,
  ): Promise<TemplateMutationView> {
    const source = await this.getRenderableOrNull(tenantId, templateId);

    if (source === null) {
      throw new NotFoundException('Template not found');
    }

    const key = dto.key ?? source.key;
    const locale = dto.locale ?? source.locale;
    const version =
      dto.version ??
      (await this.nextVersionFor(tenantId, key, source.channel, locale));
    const renderable = toRenderable(source);
    const validation = this.validation.validate(renderable);

    const created = await this.prisma.$transaction(async (tx) => {
      const row = await tx.notificationTemplate.create({
        data: {
          tenantId,
          key,
          channel: source.channel,
          locale,
          subject: source.subject,
          preheader: source.preheader,
          body: source.body,
          format: source.format,
          direction: source.direction,
          version,
          revision: 0,
          status: TemplateStatus.draft,
          active: false,
          strictVariables: source.strictVariables,
          variables: jsonInput(source.variables),
          sampleData: jsonInput(source.sampleData),
          layoutId: source.layoutId,
          themeId: source.themeId,
          fallbackProvider: source.fallbackProvider,
          fallbackChannel: source.fallbackChannel,
          partials: {
            create: source.partials.map((link) => ({ partialId: link.partialId })),
          },
        },
        include: META_INCLUDE,
      });

      await this.recordAudit(tx, {
        tenantId,
        templateId: row.id,
        templateVersion: row.version,
        action: 'cloned',
        admin,
        note: dto.note,
        metadata: {
          sourceTemplateId: source.id,
          sourceVersion: source.version,
          targetKey: key,
          targetLocale: locale,
        },
      });

      return row;
    });

    return { ...toTemplateView(created, true), validation };
  }

  async rollback(
    tenantId: string,
    admin: AdminPrincipal,
    templateId: string,
    dto: RollbackTemplateDto,
  ): Promise<TemplateMutationView> {
    const source = await this.getRenderableOrNull(tenantId, templateId);

    if (source === null) {
      throw new NotFoundException('Template not found');
    }

    const target = await this.prisma.notificationTemplate.findFirst({
      where: {
        tenantId,
        key: source.key,
        channel: source.channel,
        locale: source.locale,
        version: dto.sourceVersion,
      },
      include: FULL_INCLUDE,
    });

    if (target === null) {
      throw new NotFoundException('Source version not found');
    }

    const version = await this.nextVersionFor(
      tenantId,
      source.key,
      source.channel,
      source.locale,
    );
    const renderable = toRenderable(target);
    const validation = this.validation.validate(renderable);

    const created = await this.prisma.$transaction(async (tx) => {
      const row = await tx.notificationTemplate.create({
        data: {
          tenantId,
          key: target.key,
          channel: target.channel,
          locale: target.locale,
          subject: target.subject,
          preheader: target.preheader,
          body: target.body,
          format: target.format,
          direction: target.direction,
          version,
          revision: 0,
          status: TemplateStatus.draft,
          active: false,
          strictVariables: target.strictVariables,
          variables: jsonInput(target.variables),
          sampleData: jsonInput(target.sampleData),
          layoutId: target.layoutId,
          themeId: target.themeId,
          fallbackProvider: target.fallbackProvider,
          fallbackChannel: target.fallbackChannel,
          partials: {
            create: target.partials.map((link) => ({ partialId: link.partialId })),
          },
        },
        include: META_INCLUDE,
      });

      await this.recordAudit(tx, {
        tenantId,
        templateId: row.id,
        templateVersion: row.version,
        action: 'rolled_back',
        admin,
        note: dto.note,
        metadata: { sourceVersion: dto.sourceVersion, sourceTemplateId: target.id },
      });

      return row;
    });

    return { ...toTemplateView(created, true), validation };
  }

  async versions(tenantId: string, templateId: string): Promise<TemplateView[]> {
    const template = await this.prisma.notificationTemplate.findFirst({
      where: { id: templateId, tenantId },
      select: { key: true, channel: true, locale: true },
    });

    if (template === null) {
      throw new NotFoundException('Template not found');
    }

    const rows = await this.prisma.notificationTemplate.findMany({
      where: {
        tenantId,
        key: template.key,
        channel: template.channel,
        locale: template.locale,
      },
      include: META_INCLUDE,
      orderBy: { version: 'desc' },
    });

    return rows.map((row) => toTemplateView(row, false));
  }

  async audit(
    tenantId: string,
    templateId: string,
    query: TemplateAuditQueryDto,
  ): Promise<{ items: TemplateAuditView[]; total: number; limit: number; offset: number }> {
    await this.requireTemplate(tenantId, templateId);
    const limit = query.limit ?? 20;
    const offset = query.offset ?? 0;
    const where = { tenantId, templateId };

    const [rows, total] = await Promise.all([
      this.prisma.templateAuditEvent.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: offset,
        take: limit,
      }),
      this.prisma.templateAuditEvent.count({ where }),
    ]);

    return {
      items: rows.map((row) => ({
        id: String(row.id),
        action: row.action,
        templateVersion: row.templateVersion,
        actorAdminId: row.actorAdminId,
        actorEmail: row.actorEmail,
        note: row.note,
        metadata: row.metadata,
        createdAt: row.createdAt.toISOString(),
      })),
      total,
      limit,
      offset,
    };
  }

  async testSends(
    tenantId: string,
    templateId: string,
    query: TemplateAuditQueryDto,
  ): Promise<{ items: TemplateTestSendView[]; total: number; limit: number; offset: number }> {
    await this.requireTemplate(tenantId, templateId);
    const limit = query.limit ?? 20;
    const offset = query.offset ?? 0;
    const where = { tenantId, templateId };

    const [rows, total] = await Promise.all([
      this.prisma.templateTestSend.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: offset,
        take: limit,
      }),
      this.prisma.templateTestSend.count({ where }),
    ]);

    return {
      items: rows.map((row) => ({
        id: row.id,
        templateVersion: row.templateVersion,
        channel: row.channel,
        recipientMasked: row.recipientMasked,
        status: row.status,
        providerName: row.providerName,
        providerMessageId: row.providerMessageId,
        errorCode: row.errorCode,
        errorMessage: row.errorMessage,
        requestedByAdminId: row.requestedByAdminId,
        createdAt: row.createdAt.toISOString(),
      })),
      total,
      limit,
      offset,
    };
  }

  validateForSend(
    template: TemplateWithAssets,
    sampleData?: unknown,
  ): TemplateValidationIssue[] {
    const renderable =
      sampleData === undefined
        ? template
        : { ...template, sampleData };
    const issues = this.validation.validate(renderable);
    this.throwIfErrors(issues);

    return issues;
  }

  private async updateDraft(
    tenantId: string,
    admin: AdminPrincipal,
    existing: TemplateWithAssets,
    dto: UpdateTemplateDto,
  ): Promise<TemplateMutationView> {
    const layoutId = dto.layoutId === undefined ? existing.layoutId : dto.layoutId;
    const themeId = dto.themeId === undefined ? existing.themeId : dto.themeId;
    const layout = await this.assets.resolveLayout(tenantId, layoutId);
    const theme = await this.assets.resolveTheme(tenantId, themeId);
    const partialIds =
      dto.partialIds === undefined
        ? existing.partials.map((link) => link.partialId)
        : dto.partialIds;
    const partials = await this.assets.resolvePartials(tenantId, partialIds);
    const format = dto.format ?? existing.format;
    const renderable = buildRenderable({
      id: existing.id,
      key: existing.key,
      channel: existing.channel,
      locale: existing.locale,
      subject: dto.subject === undefined ? existing.subject : dto.subject,
      preheader: dto.preheader === undefined ? existing.preheader : dto.preheader,
      body: dto.body ?? existing.body,
      format,
      direction: dto.direction ?? existing.direction,
      revision: existing.revision,
      strictVariables: dto.strictVariables ?? existing.strictVariables,
      variables: dto.variables === undefined ? existing.variables : dto.variables,
      sampleData: dto.sampleData === undefined ? existing.sampleData : dto.sampleData,
      layout,
      theme,
      partials,
      updatedAt: existing.updatedAt,
    });
    const validation = this.validation.validate(renderable, { legacySubject: true });

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.templatePartialLink.deleteMany({ where: { templateId: existing.id } });

      const row = await tx.notificationTemplate.update({
        where: { id: existing.id },
        data: {
          ...(dto.subject === undefined ? {} : { subject: dto.subject }),
          ...(dto.preheader === undefined ? {} : { preheader: dto.preheader }),
          ...(dto.body === undefined ? {} : { body: dto.body }),
          ...(dto.format === undefined ? {} : { format }),
          ...(dto.direction === undefined ? {} : { direction: dto.direction }),
          ...(dto.strictVariables === undefined
            ? {}
            : { strictVariables: dto.strictVariables }),
          ...(dto.variables === undefined ? {} : { variables: jsonInput(dto.variables) }),
          ...(dto.sampleData === undefined ? {} : { sampleData: jsonInput(dto.sampleData) }),
          ...(dto.layoutId === undefined ? {} : { layoutId: layout?.id ?? null }),
          ...(dto.themeId === undefined ? {} : { themeId: theme?.id ?? null }),
          revision: { increment: 1 },
          partials: {
            create: partials.map((link) => ({ partialId: link.partial.id })),
          },
        },
        include: META_INCLUDE,
      });

      await this.recordAudit(tx, {
        tenantId,
        templateId: existing.id,
        templateVersion: row.version,
        action: 'draft_updated',
        admin,
        note: dto.note,
        metadata: { changed: changedFields(dto) },
      });

      return row;
    });

    return { ...toTemplateView(updated, true), validation };
  }

  private async updatePublishedViaNewVersion(
    tenantId: string,
    admin: AdminPrincipal,
    existing: TemplateWithAssets,
    dto: UpdateTemplateDto,
  ): Promise<TemplateMutationView> {
    const layoutId = dto.layoutId === undefined ? existing.layoutId : dto.layoutId;
    const themeId = dto.themeId === undefined ? existing.themeId : dto.themeId;
    const layout = await this.assets.resolveLayout(tenantId, layoutId);
    const theme = await this.assets.resolveTheme(tenantId, themeId);
    const partialIds =
      dto.partialIds === undefined
        ? existing.partials.map((link) => link.partialId)
        : dto.partialIds;
    const partials = await this.assets.resolvePartials(tenantId, partialIds);
    const format = dto.format ?? existing.format;
    const renderable = buildRenderable({
      id: existing.id,
      key: existing.key,
      channel: existing.channel,
      locale: existing.locale,
      subject: dto.subject === undefined ? existing.subject : dto.subject,
      preheader: dto.preheader === undefined ? existing.preheader : dto.preheader,
      body: dto.body ?? existing.body,
      format,
      direction: dto.direction ?? existing.direction,
      revision: 0,
      strictVariables: dto.strictVariables ?? existing.strictVariables,
      variables: dto.variables === undefined ? existing.variables : dto.variables,
      sampleData: dto.sampleData === undefined ? existing.sampleData : dto.sampleData,
      layout,
      theme,
      partials,
      updatedAt: new Date(),
    });
    const validation = this.validation.validate(renderable, { legacySubject: true });
    this.throwIfErrors(validation);

    const version = await this.nextVersionFor(
      tenantId,
      existing.key,
      existing.channel,
      existing.locale,
    );

    const created = await this.prisma.$transaction(async (tx) => {
      await this.deactivateOthers(
        tx,
        tenantId,
        existing.key,
        existing.channel,
        existing.locale,
        undefined,
      );

      const row = await tx.notificationTemplate.create({
        data: {
          tenantId,
          key: existing.key,
          channel: existing.channel,
          locale: existing.locale,
          subject: dto.subject === undefined ? existing.subject : dto.subject,
          preheader: dto.preheader === undefined ? existing.preheader : dto.preheader,
          body: dto.body ?? existing.body,
          format,
          direction: dto.direction ?? existing.direction,
          version,
          revision: 0,
          status: TemplateStatus.published,
          active: true,
          strictVariables: dto.strictVariables ?? existing.strictVariables,
          variables: jsonInput(
            dto.variables === undefined ? existing.variables : dto.variables,
          ),
          sampleData: jsonInput(
            dto.sampleData === undefined ? existing.sampleData : dto.sampleData,
          ),
          layoutId: layout?.id ?? null,
          themeId: theme?.id ?? null,
          fallbackProvider:
            dto.fallbackProvider === undefined
              ? existing.fallbackProvider
              : dto.fallbackProvider,
          fallbackChannel:
            dto.fallbackChannel === undefined ? existing.fallbackChannel : dto.fallbackChannel,
          publishedAt: new Date(),
          publishedByAdminId: admin.adminId,
          partials: {
            create: partials.map((link) => ({ partialId: link.partial.id })),
          },
        },
        include: META_INCLUDE,
      });

      await this.recordAudit(tx, {
        tenantId,
        templateId: row.id,
        templateVersion: row.version,
        action: 'published',
        admin,
        note: dto.note,
        metadata: {
          legacyPut: true,
          sourceTemplateId: existing.id,
          sourceVersion: existing.version,
          changed: changedFields(dto),
        },
      });

      return row;
    });

    this.logger.info(
      {
        event: 'admin.template.published',
        tenant_id: tenantId,
        template_id: created.id,
        source_template_id: existing.id,
        key: created.key,
        version: created.version,
        legacy_put: true,
      },
      'template published as a new version through the legacy update endpoint',
    );

    return { ...toTemplateView(created, true), validation };
  }

  private async updatePublishedMetadata(
    tenantId: string,
    admin: AdminPrincipal,
    existing: TemplateWithAssets,
    dto: UpdateTemplateDto,
  ): Promise<TemplateMutationView> {
    if (dto.body !== undefined || dto.subject !== undefined || dto.preheader !== undefined) {
      throw new BadRequestException('published content must be changed through a new draft');
    }

    if (dto.active === true) {
      const latest = await this.prisma.notificationTemplate.findFirst({
        where: {
          tenantId,
          key: existing.key,
          channel: existing.channel,
          locale: existing.locale,
          status: TemplateStatus.published,
        },
        orderBy: { version: 'desc' },
        select: { id: true },
      });

      if (latest?.id !== existing.id) {
        throw new ConflictException(
          'only the highest published version can be activated; use rollback to create a new version',
        );
      }
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      if (dto.active === true) {
        await this.deactivateOthers(
          tx,
          tenantId,
          existing.key,
          existing.channel,
          existing.locale,
          existing.id,
        );
      }

      const row = await tx.notificationTemplate.update({
        where: { id: existing.id },
        data: {
          ...(dto.active === undefined ? {} : { active: dto.active }),
          ...(dto.fallbackProvider === undefined
            ? {}
            : { fallbackProvider: dto.fallbackProvider }),
          ...(dto.fallbackChannel === undefined
            ? {}
            : { fallbackChannel: dto.fallbackChannel }),
          revision: { increment: 1 },
        },
        include: META_INCLUDE,
      });

      await this.recordAudit(tx, {
        tenantId,
        templateId: existing.id,
        templateVersion: row.version,
        action: 'updated',
        admin,
        note: dto.note,
        metadata: { changed: changedFields(dto) },
      });

      return row;
    });

    return { ...toTemplateView(updated, true), validation: [] };
  }

  private async getRenderableOrNull(
    tenantId: string,
    templateId: string,
  ): Promise<TemplateWithAssets | null> {
    return this.prisma.notificationTemplate.findFirst({
      where: { id: templateId, tenantId },
      include: FULL_INCLUDE,
    });
  }

  private async requireTemplate(tenantId: string, templateId: string): Promise<void> {
    const existing = await this.prisma.notificationTemplate.findFirst({
      where: { id: templateId, tenantId },
      select: { id: true },
    });

    if (existing === null) {
      throw new NotFoundException('Template not found');
    }
  }

  private async nextVersion(
    tenantId: string,
    dto: CreateTemplateDto,
  ): Promise<number> {
    return this.nextVersionFor(tenantId, dto.key, dto.channel, dto.locale);
  }

  private async nextVersionFor(
    tenantId: string,
    key: string,
    channel: Channel,
    locale: string,
  ): Promise<number> {
    const aggregate = await this.prisma.notificationTemplate.aggregate({
      where: { tenantId, key, channel, locale },
      _max: { version: true },
    });

    return (aggregate._max.version ?? 0) + 1;
  }

  private async deactivateOthers(
    tx: Prisma.TransactionClient,
    tenantId: string,
    key: string,
    channel: Channel,
    locale: string,
    exceptId: string | undefined,
  ): Promise<void> {
    await tx.notificationTemplate.updateMany({
      where: {
        tenantId,
        key,
        channel,
        locale,
        status: TemplateStatus.published,
        active: true,
        ...(exceptId === undefined ? {} : { id: { not: exceptId } }),
      },
      data: { active: false },
    });
  }

  private async recordAudit(
    tx: Prisma.TransactionClient,
    input: {
      tenantId: string;
      templateId: string;
      templateVersion: number;
      action:
        | 'created'
        | 'draft_updated'
        | 'updated'
        | 'published'
        | 'deactivated'
        | 'activated'
        | 'cloned'
        | 'rolled_back'
        | 'test_sent';
      admin: AdminPrincipal;
      note?: string;
      metadata?: Record<string, unknown>;
    },
  ): Promise<void> {
    await tx.templateAuditEvent.create({
      data: {
        tenantId: input.tenantId,
        templateId: input.templateId,
        templateVersion: input.templateVersion,
        action: input.action,
        actorAdminId: input.admin.adminId,
        actorEmail: input.admin.email,
        note: input.note ?? null,
        metadata: input.metadata === undefined ? Prisma.DbNull : (input.metadata as Prisma.InputJsonValue),
      },
    });
  }

  private throwIfErrors(issues: TemplateValidationIssue[]): void {
    const errors = issues.filter((issue) => issue.severity === 'error');

    if (errors.length === 0) {
      return;
    }

    throw new UnprocessableEntityException({
      message: errors.map((issue) => `${issue.path}: ${issue.message}`),
      details: {
        code: 'template_validation_failed',
        errors,
      },
    });
  }
}

function normalizeFormat(channel: Channel, requested: TemplateFormat | undefined): TemplateFormat {
  const expected = channel === Channel.email ? TemplateFormat.html : TemplateFormat.text;

  if (requested !== undefined && requested !== expected) {
    throw new BadRequestException(
      `channel ${channel} only supports format ${expected}`,
    );
  }

  return requested ?? expected;
}

function hasContentChanges(dto: UpdateTemplateDto, existing: TemplateWithAssets): boolean {
  if (dto.body !== undefined && dto.body !== existing.body) return true;
  if (dto.subject !== undefined && dto.subject !== existing.subject) return true;
  if (dto.preheader !== undefined && dto.preheader !== existing.preheader) return true;
  if (dto.format !== undefined && dto.format !== existing.format) return true;
  if (dto.direction !== undefined && dto.direction !== existing.direction) return true;
  if (
    dto.strictVariables !== undefined &&
    dto.strictVariables !== existing.strictVariables
  )
    return true;
  if (dto.variables !== undefined) return true;
  if (dto.sampleData !== undefined) return true;
  if (dto.layoutId !== undefined && dto.layoutId !== existing.layoutId) return true;
  if (dto.themeId !== undefined && dto.themeId !== existing.themeId) return true;
  if (
    dto.partialIds !== undefined &&
    !sameStringSet(dto.partialIds, existing.partials.map((link) => link.partialId))
  )
    return true;

  return false;
}

function changedFields(dto: UpdateTemplateDto): string[] {
  const fields: string[] = [];

  for (const key of [
    'subject',
    'preheader',
    'body',
    'format',
    'direction',
    'strictVariables',
    'variables',
    'sampleData',
    'layoutId',
    'themeId',
    'partialIds',
    'fallbackProvider',
    'fallbackChannel',
    'active',
  ] as const) {
    if (dto[key] !== undefined) {
      fields.push(key);
    }
  }

  return fields;
}

function sameStringSet(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();

  return sortedLeft.every((value, index) => value === sortedRight[index]);
}

function jsonInput(value: unknown): Prisma.InputJsonValue | typeof Prisma.DbNull {
  if (value === null || value === undefined) {
    return Prisma.DbNull;
  }

  return value as Prisma.InputJsonValue;
}

function mapUniqueError(error: unknown): unknown {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    return new ConflictException(
      'a template with this key, channel, locale and version already exists',
    );
  }

  return error;
}

function toRenderable(template: TemplateWithAssets): TemplateWithAssets {
  return template;
}

function toTemplateView(template: TemplateMeta, full: boolean): TemplateView {
  return {
    id: template.id,
    tenantId: template.tenantId,
    key: template.key,
    channel: template.channel,
    locale: template.locale,
    subject: template.subject,
    preheader: template.preheader,
    body: full ? template.body : null,
    bodyPreview: template.body.slice(0, 200),
    format: template.format,
    direction: template.direction,
    version: template.version,
    revision: template.revision,
    status: template.status,
    active: template.active,
    strictVariables: template.strictVariables,
    variables: template.variables,
    sampleData: template.sampleData,
    layoutId: template.layoutId,
    themeId: template.themeId,
    partialIds: template.partials.map((link) => link.partialId),
    layout:
      template.layout === null
        ? null
        : {
            id: template.layout.id,
            key: template.layout.key,
            version: template.layout.version,
            name: template.layout.name,
          },
    theme:
      template.theme === null
        ? null
        : {
            id: template.theme.id,
            key: template.theme.key,
            version: template.theme.version,
            name: template.theme.name,
          },
    fallbackProvider: template.fallbackProvider,
    fallbackChannel: template.fallbackChannel,
    publishedAt: template.publishedAt?.toISOString() ?? null,
    publishedByAdminId: template.publishedByAdminId,
    createdAt: template.createdAt.toISOString(),
    updatedAt: template.updatedAt.toISOString(),
  };
}
