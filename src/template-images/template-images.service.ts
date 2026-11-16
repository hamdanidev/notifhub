import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { access, mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { TemplateImage } from '@prisma/client';
import { PinoLogger } from 'nestjs-pino';
import { PrismaService } from '../prisma/prisma.service';
import {
  detectImage,
  type TemplateImageMimeType,
  type UploadedImageFile,
} from './template-images.types';

const MAX_IMAGE_DIMENSION = 4_000;
const MAX_LIST_LIMIT = 100;

export interface TemplateImageView {
  id: string;
  url: string;
  mimeType: TemplateImageMimeType;
  width: number;
  height: number;
  size: number;
  createdAt: string;
}

export interface TemplateImageDownload {
  row: TemplateImage;
  filePath: string;
}

@Injectable()
export class TemplateImagesService {
  private readonly directory: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(TemplateImagesService.name);
    this.directory = path.resolve(
      this.config.getOrThrow<string>('TEMPLATE_IMAGE_DIR'),
    );
  }

  async upload(
    tenantId: string,
    adminId: string,
    file: UploadedImageFile | undefined,
    baseUrl: string,
  ): Promise<TemplateImageView> {
    if (file === undefined || file.buffer.length === 0) {
      throw new BadRequestException({
        message: 'file gambar wajib diunggah pada field "file"',
        details: { code: 'image_file_missing' },
      });
    }

    const maxBytes = this.config.getOrThrow<number>('TEMPLATE_IMAGE_MAX_BYTES');

    if (file.buffer.length > maxBytes) {
      throw new PayloadTooLargeException({
        message: `ukuran gambar melebihi batas ${maxBytes} byte`,
        details: { code: 'image_too_large', maxBytes },
      });
    }

    const detected = detectImage(file.buffer);

    if (detected === null) {
      throw new BadRequestException({
        message: 'file harus berupa gambar PNG, JPEG, WebP, atau GIF yang valid',
        details: { code: 'invalid_image' },
      });
    }

    if (
      detected.width > MAX_IMAGE_DIMENSION ||
      detected.height > MAX_IMAGE_DIMENSION
    ) {
      throw new BadRequestException({
        message: `dimensi gambar maksimum ${MAX_IMAGE_DIMENSION}×${MAX_IMAGE_DIMENSION}`,
        details: { code: 'image_dimension_too_large' },
      });
    }

    const id = randomUUID();
    const storageKey = `${id}.${detected.extension}`;
    const filePath = this.resolvePath(storageKey);
    const checksum = createHash('sha256').update(file.buffer).digest('hex');

    await mkdir(this.directory, { recursive: true });
    await writeFile(filePath, file.buffer, { mode: 0o600 });

    let row: TemplateImage;

    try {
      row = await this.prisma.templateImage.create({
        data: {
          id,
          tenantId,
          mimeType: detected.mimeType,
          size: file.buffer.length,
          width: detected.width,
          height: detected.height,
          storageKey,
          checksum,
          createdByAdminId: adminId,
        },
      });
    } catch (error) {
      await unlink(filePath).catch(() => undefined);
      throw error;
    }

    this.logger.info(
      {
        event: 'admin.template_image.uploaded',
        tenant_id: tenantId,
        image_id: row.id,
        mime_type: row.mimeType,
        width: row.width,
        height: row.height,
        size: row.size,
      },
      'template image uploaded',
    );

    return this.toView(row, baseUrl);
  }

  async list(
    tenantId: string,
    limit: number | undefined,
    baseUrl: string,
  ): Promise<{ items: TemplateImageView[] }> {
    const take =
      limit === undefined || !Number.isInteger(limit)
        ? 50
        : Math.min(MAX_LIST_LIMIT, Math.max(1, limit));

    const rows = await this.prisma.templateImage.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take,
    });

    return { items: rows.map((row) => this.toView(row, baseUrl)) };
  }

  async getForDownload(id: string): Promise<TemplateImageDownload> {
    const row = await this.prisma.templateImage.findUnique({ where: { id } });

    if (row === null) {
      throw new NotFoundException('Image not found');
    }

    const filePath = this.resolvePath(row.storageKey);

    try {
      await access(filePath);
    } catch {
      this.logger.error(
        { event: 'template_image.file_missing', image_id: row.id },
        'template image metadata exists but the stored file is missing',
      );
      throw new NotFoundException('Image file not found');
    }

    return { row, filePath };
  }

  read(filePath: string): ReturnType<typeof createReadStream> {
    return createReadStream(filePath);
  }

  private resolvePath(storageKey: string): string {
    const resolved = path.resolve(this.directory, path.basename(storageKey));

    if (!resolved.startsWith(`${this.directory}${path.sep}`)) {
      throw new BadRequestException('invalid image storage key');
    }

    return resolved;
  }

  private toView(row: TemplateImage, baseUrl: string): TemplateImageView {
    return {
      id: row.id,
      url: `${baseUrl.replace(/\/+$/, '')}/api/v1/template-images/${row.id}`,
      mimeType: row.mimeType as TemplateImageMimeType,
      width: row.width,
      height: row.height,
      size: row.size,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
