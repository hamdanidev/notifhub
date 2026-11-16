import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type NotificationTemplate } from '@prisma/client';
import { PinoLogger } from 'nestjs-pino';
import { PrismaService } from '../../prisma/prisma.service';
import type {
  CreateTemplateDto,
  TemplateListQueryDto,
  UpdateTemplateDto,
} from '../dto/template.dto';

export interface TemplateView {
  id: string;
  tenantId: string;
  key: string;
  channel: string;
  locale: string;
  subject: string | null;
  body: string;
  version: number;
  active: boolean;
  fallbackProvider: string | null;
  fallbackChannel: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TemplateListResult {
  items: TemplateView[];
  total: number;
  limit: number;
  offset: number;
}

@Injectable()
export class AdminTemplatesService {
  constructor(
    private readonly prisma: PrismaService,
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
      ...(query.search === undefined
        ? {}
        : { key: { contains: query.search, mode: 'insensitive' } }),
    };

    const [rows, total] = await Promise.all([
      this.prisma.notificationTemplate.findMany({
        where,
        orderBy: [{ key: 'asc' }, { channel: 'asc' }, { locale: 'asc' }, { version: 'desc' }],
        skip: offset,
        take: limit,
      }),
      this.prisma.notificationTemplate.count({ where }),
    ]);

    return { items: rows.map(toTemplateView), total, limit, offset };
  }

  async get(tenantId: string, templateId: string): Promise<TemplateView> {
    const template = await this.prisma.notificationTemplate.findFirst({
      where: { id: templateId, tenantId },
    });

    if (template === null) {
      throw new NotFoundException('Template not found');
    }

    return toTemplateView(template);
  }

  async create(tenantId: string, dto: CreateTemplateDto): Promise<TemplateView> {
    try {
      const template = await this.prisma.notificationTemplate.create({
        data: {
          tenantId,
          key: dto.key,
          channel: dto.channel,
          locale: dto.locale,
          subject: dto.subject ?? null,
          body: dto.body,
          version: dto.version ?? 1,
          active: dto.active ?? true,
          fallbackProvider: dto.fallbackProvider ?? null,
          fallbackChannel: dto.fallbackChannel ?? null,
        },
      });

      this.logger.info(
        {
          event: 'admin.template.created',
          tenant_id: tenantId,
          template_id: template.id,
          key: template.key,
          channel: template.channel,
          locale: template.locale,
          version: template.version,
        },
        'template created',
      );

      return toTemplateView(template);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException(
          'a template with this key, channel, locale and version already exists',
        );
      }

      throw error;
    }
  }

  async update(
    tenantId: string,
    templateId: string,
    dto: UpdateTemplateDto,
  ): Promise<TemplateView> {
    const existing = await this.prisma.notificationTemplate.findFirst({
      where: { id: templateId, tenantId },
      select: { id: true },
    });

    if (existing === null) {
      throw new NotFoundException('Template not found');
    }

    const template = await this.prisma.notificationTemplate.update({
      where: { id: templateId },
      data: {
        ...(dto.subject === undefined ? {} : { subject: dto.subject }),
        ...(dto.body === undefined ? {} : { body: dto.body }),
        ...(dto.active === undefined ? {} : { active: dto.active }),
        ...(dto.fallbackProvider === undefined
          ? {}
          : { fallbackProvider: dto.fallbackProvider }),
        ...(dto.fallbackChannel === undefined
          ? {}
          : { fallbackChannel: dto.fallbackChannel }),
      },
    });

    this.logger.info(
      { event: 'admin.template.updated', tenant_id: tenantId, template_id: template.id },
      'template updated',
    );

    return toTemplateView(template);
  }

  async deactivate(tenantId: string, templateId: string): Promise<TemplateView> {
    const existing = await this.prisma.notificationTemplate.findFirst({
      where: { id: templateId, tenantId },
      select: { id: true },
    });

    if (existing === null) {
      throw new NotFoundException('Template not found');
    }

    const template = await this.prisma.notificationTemplate.update({
      where: { id: templateId },
      data: { active: false },
    });

    this.logger.info(
      { event: 'admin.template.deactivated', tenant_id: tenantId, template_id: template.id },
      'template deactivated (soft delete)',
    );

    return toTemplateView(template);
  }
}

function toTemplateView(template: NotificationTemplate): TemplateView {
  return {
    id: template.id,
    tenantId: template.tenantId,
    key: template.key,
    channel: template.channel,
    locale: template.locale,
    subject: template.subject,
    body: template.body,
    version: template.version,
    active: template.active,
    fallbackProvider: template.fallbackProvider,
    fallbackChannel: template.fallbackChannel,
    createdAt: template.createdAt.toISOString(),
    updatedAt: template.updatedAt.toISOString(),
  };
}
