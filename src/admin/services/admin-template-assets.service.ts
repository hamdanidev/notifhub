import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type TemplateLayout, type TemplatePartial, type TemplateTheme } from '@prisma/client';
import { PinoLogger } from 'nestjs-pino';
import { PrismaService } from '../../prisma/prisma.service';
import type {
  CreateTemplateLayoutDto,
  CreateTemplatePartialDto,
  CreateTemplateThemeDto,
  TemplateAssetListQueryDto,
} from '../dto/template-asset.dto';
import type { RenderableTemplate } from '../../templates/template.types';

export interface LayoutView {
  id: string;
  tenantId: string;
  key: string;
  version: number;
  name: string;
  content: string | null;
  contentPreview: string;
  usageCount: number;
  createdAt: string;
}

export interface ThemeView {
  id: string;
  tenantId: string;
  key: string;
  version: number;
  name: string;
  tokens: Record<string, unknown> | null;
  tokenKeys: string[];
  usageCount: number;
  createdAt: string;
}

export interface PartialView {
  id: string;
  tenantId: string;
  key: string;
  version: number;
  name: string;
  content: string | null;
  contentPreview: string;
  usageCount: number;
  createdAt: string;
}

export interface AssetListResult<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

@Injectable()
export class AdminTemplateAssetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(AdminTemplateAssetsService.name);
  }

  async listLayouts(
    tenantId: string,
    query: TemplateAssetListQueryDto,
  ): Promise<AssetListResult<LayoutView>> {
    const rows = await this.prisma.templateLayout.findMany({
      where: {
        tenantId,
        ...(query.key === undefined ? {} : { key: query.key }),
      },
      include: { _count: { select: { templates: true } } },
      orderBy: [{ key: 'asc' }, { version: 'desc' }],
    });
    const selected = query.latest === true ? latestByKey(rows) : rows;
    const limit = query.limit ?? 20;
    const offset = query.offset ?? 0;

    return {
      items: selected
        .slice(offset, offset + limit)
        .map((row) => toLayoutView(row, false, row._count.templates)),
      total: selected.length,
      limit,
      offset,
    };
  }

  async getLayout(tenantId: string, id: string): Promise<LayoutView> {
    const row = await this.prisma.templateLayout.findFirst({
      where: { id, tenantId },
      include: { _count: { select: { templates: true } } },
    });

    if (row === null) {
      throw new NotFoundException('Layout not found');
    }

    return toLayoutView(row, true, row._count.templates);
  }

  async createLayout(
    tenantId: string,
    adminId: string,
    dto: CreateTemplateLayoutDto,
  ): Promise<LayoutView> {
    const version = await this.nextVersion('layout', tenantId, dto.key);
    const row = await this.prisma.templateLayout.create({
      data: {
        tenantId,
        key: dto.key,
        version,
        name: dto.name,
        content: dto.content,
        createdByAdminId: adminId,
      },
    });

    this.logger.info(
      {
        event: 'admin.template_layout.created',
        tenant_id: tenantId,
        layout_id: row.id,
        key: row.key,
        version: row.version,
        note: dto.note,
      },
      'template layout version created',
    );

    return toLayoutView(row, true);
  }

  async deleteLayout(tenantId: string, id: string): Promise<void> {
    const row = await this.prisma.templateLayout.findFirst({
      where: { id, tenantId },
      include: { _count: { select: { templates: true } } },
    });

    if (row === null) {
      throw new NotFoundException('Layout not found');
    }

    if (row._count.templates > 0) {
      throw assetInUse('layout', row._count.templates);
    }

    try {
      await this.prisma.templateLayout.delete({ where: { id } });
    } catch (error) {
      throw mapAssetDeleteError(error, 'layout');
    }

    this.logger.info(
      {
        event: 'admin.template_layout.deleted',
        tenant_id: tenantId,
        layout_id: id,
        key: row.key,
        version: row.version,
      },
      'unused template layout version deleted',
    );
  }

  async listThemes(
    tenantId: string,
    query: TemplateAssetListQueryDto,
  ): Promise<AssetListResult<ThemeView>> {
    const rows = await this.prisma.templateTheme.findMany({
      where: {
        tenantId,
        ...(query.key === undefined ? {} : { key: query.key }),
      },
      include: { _count: { select: { templates: true } } },
      orderBy: [{ key: 'asc' }, { version: 'desc' }],
    });
    const selected = query.latest === true ? latestByKey(rows) : rows;
    const limit = query.limit ?? 20;
    const offset = query.offset ?? 0;

    return {
      items: selected
        .slice(offset, offset + limit)
        .map((row) => toThemeView(row, false, row._count.templates)),
      total: selected.length,
      limit,
      offset,
    };
  }

  async getTheme(tenantId: string, id: string): Promise<ThemeView> {
    const row = await this.prisma.templateTheme.findFirst({
      where: { id, tenantId },
      include: { _count: { select: { templates: true } } },
    });

    if (row === null) {
      throw new NotFoundException('Theme not found');
    }

    return toThemeView(row, true, row._count.templates);
  }

  async createTheme(
    tenantId: string,
    adminId: string,
    dto: CreateTemplateThemeDto,
  ): Promise<ThemeView> {
    const version = await this.nextVersion('theme', tenantId, dto.key);
    const row = await this.prisma.templateTheme.create({
      data: {
        tenantId,
        key: dto.key,
        version,
        name: dto.name,
        tokens: dto.tokens as Prisma.InputJsonValue,
        createdByAdminId: adminId,
      },
    });

    this.logger.info(
      {
        event: 'admin.template_theme.created',
        tenant_id: tenantId,
        theme_id: row.id,
        key: row.key,
        version: row.version,
        note: dto.note,
      },
      'template theme version created',
    );

    return toThemeView(row, true);
  }

  async deleteTheme(tenantId: string, id: string): Promise<void> {
    const row = await this.prisma.templateTheme.findFirst({
      where: { id, tenantId },
      include: { _count: { select: { templates: true } } },
    });

    if (row === null) {
      throw new NotFoundException('Theme not found');
    }

    if (row._count.templates > 0) {
      throw assetInUse('theme', row._count.templates);
    }

    try {
      await this.prisma.templateTheme.delete({ where: { id } });
    } catch (error) {
      throw mapAssetDeleteError(error, 'theme');
    }

    this.logger.info(
      {
        event: 'admin.template_theme.deleted',
        tenant_id: tenantId,
        theme_id: id,
        key: row.key,
        version: row.version,
      },
      'unused template theme version deleted',
    );
  }

  async listPartials(
    tenantId: string,
    query: TemplateAssetListQueryDto,
  ): Promise<AssetListResult<PartialView>> {
    const rows = await this.prisma.templatePartial.findMany({
      where: {
        tenantId,
        ...(query.key === undefined ? {} : { key: query.key }),
      },
      include: { _count: { select: { links: true } } },
      orderBy: [{ key: 'asc' }, { version: 'desc' }],
    });
    const selected = query.latest === true ? latestByKey(rows) : rows;
    const limit = query.limit ?? 20;
    const offset = query.offset ?? 0;

    return {
      items: selected
        .slice(offset, offset + limit)
        .map((row) => toPartialView(row, false, row._count.links)),
      total: selected.length,
      limit,
      offset,
    };
  }

  async getPartial(tenantId: string, id: string): Promise<PartialView> {
    const row = await this.prisma.templatePartial.findFirst({
      where: { id, tenantId },
      include: { _count: { select: { links: true } } },
    });

    if (row === null) {
      throw new NotFoundException('Partial not found');
    }

    return toPartialView(row, true, row._count.links);
  }

  async createPartial(
    tenantId: string,
    adminId: string,
    dto: CreateTemplatePartialDto,
  ): Promise<PartialView> {
    const version = await this.nextVersion('partial', tenantId, dto.key);
    const row = await this.prisma.templatePartial.create({
      data: {
        tenantId,
        key: dto.key,
        version,
        name: dto.name,
        content: dto.content,
        createdByAdminId: adminId,
      },
    });

    this.logger.info(
      {
        event: 'admin.template_partial.created',
        tenant_id: tenantId,
        partial_id: row.id,
        key: row.key,
        version: row.version,
        note: dto.note,
      },
      'template partial version created',
    );

    return toPartialView(row, true);
  }

  async deletePartial(tenantId: string, id: string): Promise<void> {
    const row = await this.prisma.templatePartial.findFirst({
      where: { id, tenantId },
      include: { _count: { select: { links: true } } },
    });

    if (row === null) {
      throw new NotFoundException('Partial not found');
    }

    if (row._count.links > 0) {
      throw assetInUse('partial', row._count.links);
    }

    try {
      await this.prisma.templatePartial.delete({ where: { id } });
    } catch (error) {
      throw mapAssetDeleteError(error, 'partial');
    }

    this.logger.info(
      {
        event: 'admin.template_partial.deleted',
        tenant_id: tenantId,
        partial_id: id,
        key: row.key,
        version: row.version,
      },
      'unused template partial version deleted',
    );
  }

  async resolveLayout(
    tenantId: string,
    layoutId: string | null | undefined,
  ): Promise<RenderableTemplate['layout']> {
    if (layoutId === null || layoutId === undefined) {
      return null;
    }

    const row = await this.prisma.templateLayout.findFirst({ where: { id: layoutId, tenantId } });

    if (row === null) {
      throw new NotFoundException('Layout not found for this tenant');
    }

    return { id: row.id, key: row.key, version: row.version, content: row.content };
  }

  async resolveTheme(
    tenantId: string,
    themeId: string | null | undefined,
  ): Promise<RenderableTemplate['theme']> {
    if (themeId === null || themeId === undefined) {
      return null;
    }

    const row = await this.prisma.templateTheme.findFirst({ where: { id: themeId, tenantId } });

    if (row === null) {
      throw new NotFoundException('Theme not found for this tenant');
    }

    return { id: row.id, key: row.key, version: row.version, tokens: row.tokens };
  }

  async resolvePartials(
    tenantId: string,
    partialIds: string[] | undefined,
  ): Promise<RenderableTemplate['partials']> {
    if (partialIds === undefined || partialIds.length === 0) {
      return [];
    }

    const rows = await this.prisma.templatePartial.findMany({
      where: { id: { in: [...new Set(partialIds)] }, tenantId },
    });

    if (rows.length !== new Set(partialIds).size) {
      throw new NotFoundException('One or more partials were not found for this tenant');
    }

    const keys = new Set<string>();

    for (const row of rows) {
      if (keys.has(row.key)) {
        throw new NotFoundException(`Duplicate partial key in selection: ${row.key}`);
      }
      keys.add(row.key);
    }

    return rows.map((row) => ({
      partial: { id: row.id, key: row.key, version: row.version, content: row.content },
    }));
  }

  private async nextVersion(
    kind: 'layout' | 'theme' | 'partial',
    tenantId: string,
    key: string,
  ): Promise<number> {
    if (kind === 'layout') {
      const aggregate = await this.prisma.templateLayout.aggregate({
        where: { tenantId, key },
        _max: { version: true },
      });
      return (aggregate._max.version ?? 0) + 1;
    }

    if (kind === 'theme') {
      const aggregate = await this.prisma.templateTheme.aggregate({
        where: { tenantId, key },
        _max: { version: true },
      });
      return (aggregate._max.version ?? 0) + 1;
    }

    const aggregate = await this.prisma.templatePartial.aggregate({
      where: { tenantId, key },
      _max: { version: true },
    });
    return (aggregate._max.version ?? 0) + 1;
  }
}

function latestByKey<T extends { key: string; version: number }>(rows: T[]): T[] {
  const selected = new Map<string, T>();

  for (const row of rows) {
    const current = selected.get(row.key);

    if (current === undefined || row.version > current.version) {
      selected.set(row.key, row);
    }
  }

  return [...selected.values()].sort((left, right) => left.key.localeCompare(right.key));
}

function toLayoutView(
  row: TemplateLayout,
  full: boolean,
  usageCount = 0,
): LayoutView {
  return {
    id: row.id,
    tenantId: row.tenantId,
    key: row.key,
    version: row.version,
    name: row.name,
    content: full ? row.content : null,
    contentPreview: row.content.slice(0, 200),
    usageCount,
    createdAt: row.createdAt.toISOString(),
  };
}

function toThemeView(
  row: TemplateTheme,
  full: boolean,
  usageCount = 0,
): ThemeView {
  const tokens = isRecord(row.tokens) ? row.tokens : {};

  return {
    id: row.id,
    tenantId: row.tenantId,
    key: row.key,
    version: row.version,
    name: row.name,
    tokens: full ? tokens : null,
    tokenKeys: Object.keys(tokens),
    usageCount,
    createdAt: row.createdAt.toISOString(),
  };
}

function toPartialView(
  row: TemplatePartial,
  full: boolean,
  usageCount = 0,
): PartialView {
  return {
    id: row.id,
    tenantId: row.tenantId,
    key: row.key,
    version: row.version,
    name: row.name,
    content: full ? row.content : null,
    contentPreview: row.content.slice(0, 200),
    usageCount,
    createdAt: row.createdAt.toISOString(),
  };
}

function assetInUse(kind: 'layout' | 'theme' | 'partial', usageCount: number): ConflictException {
  return new ConflictException({
    message: `${kind} masih dipakai dan tidak dapat dihapus`,
    details: {
      code: 'asset_in_use',
      assetType: kind,
      usageCount,
    },
  });
}

function mapAssetDeleteError(
  error: unknown,
  kind: 'layout' | 'theme' | 'partial',
): unknown {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
    return assetInUse(kind, 1);
  }

  return error;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
