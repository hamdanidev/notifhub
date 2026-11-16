import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConsumes,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { AdminJwtGuard } from '../auth/admin/admin-jwt.guard';
import type { AdminPrincipal } from '../auth/admin/admin.types';
import { CurrentAdmin } from '../admin/decorators/current-admin.decorator';
import {
  TemplateImagesService,
  type TemplateImageView,
} from './template-images.service';
import type { UploadedImageFile } from './template-images.types';

const MULTER_HARD_LIMIT_BYTES = 10 * 1024 * 1024;

function resolveBaseUrl(request: Request, config: ConfigService): string {
  const configured = config.get<string>('TEMPLATE_IMAGE_BASE_URL');

  if (configured !== undefined && configured.length > 0) {
    return configured.replace(/\/+$/, '');
  }

  const host = request.get('host') ?? 'localhost';

  return `${request.protocol}://${host}`;
}

function parseLimit(raw: string | undefined): number | undefined {
  if (raw === undefined) {
    return undefined;
  }

  const parsed = Number(raw);

  return Number.isInteger(parsed) ? parsed : undefined;
}

@ApiTags('admin')
@ApiBearerAuth('admin-jwt')
@Controller('admin/template-assets/images')
@UseGuards(AdminJwtGuard)
export class AdminTemplateImagesController {
  constructor(
    private readonly images: TemplateImagesService,
    private readonly config: ConfigService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Upload a template image (multipart field: file)' })
  @ApiConsumes('multipart/form-data')
  @ApiCreatedResponse({ description: 'Stored image metadata with public URL' })
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MULTER_HARD_LIMIT_BYTES, files: 1 },
    }),
  )
  upload(
    @CurrentAdmin() admin: AdminPrincipal,
    @UploadedFile() file: UploadedImageFile | undefined,
    @Req() request: Request,
  ): Promise<TemplateImageView> {
    return this.images.upload(
      admin.tenantId,
      admin.adminId,
      file,
      resolveBaseUrl(request, this.config),
    );
  }

  @Get()
  @ApiOperation({ summary: 'List template images for the tenant' })
  @ApiOkResponse({ description: 'Template image list' })
  list(
    @CurrentAdmin() admin: AdminPrincipal,
    @Query('limit') limit: string | undefined,
    @Req() request: Request,
  ): Promise<{ items: TemplateImageView[] }> {
    return this.images.list(
      admin.tenantId,
      parseLimit(limit),
      resolveBaseUrl(request, this.config),
    );
  }
}

@ApiTags('template-images')
@Controller('template-images')
export class PublicTemplateImagesController {
  constructor(private readonly images: TemplateImagesService) {}

  @Get(':id')
  @ApiOperation({ summary: 'Serve a public template image by id' })
  @ApiOkResponse({ description: 'Image bytes' })
  async get(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const { row, filePath } = await this.images.getForDownload(id);
    const extension = row.mimeType === 'image/jpeg' ? 'jpg' : row.mimeType.split('/')[1];

    response.setHeader('Content-Type', row.mimeType);
    response.setHeader('Content-Length', String(row.size));
    response.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader(
      'Content-Disposition',
      `inline; filename="${row.id}.${extension ?? 'bin'}"`,
    );

    return new StreamableFile(this.images.read(filePath));
  }
}
