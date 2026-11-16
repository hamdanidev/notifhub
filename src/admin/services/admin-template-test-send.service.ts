import { createHash, randomUUID } from 'node:crypto';
import {
  BadGatewayException,
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Channel, Prisma } from '@prisma/client';
import { PinoLogger } from 'nestjs-pino';
import type { AdminPrincipal } from '../../auth/admin/admin.types';
import { PrismaService } from '../../prisma/prisma.service';
import { ProviderExecutor } from '../../providers/provider-executor.service';
import { ProviderRegistry } from '../../providers/provider-registry.service';
import { normalizeWhatsAppNumber } from '../../providers/whatsapp/whatsapp.types';
import { TemplateService } from '../../templates/template.service';
import { TemplateRenderError, type RenderedTemplate } from '../../templates/template.types';
import { AdminTemplatesService } from './admin-templates.service';
import type { TestSendTemplateDto } from '../dto/template.dto';

const MAX_PER_ADMIN_HOUR = 10;
const MAX_PER_TENANT_DAY = 30;

export interface TestSendResult {
  status: 'sent' | 'simulated' | 'failed';
  mode: 'development' | 'staging' | 'production';
  channel: Channel;
  provider: string;
  providerMessageId: string | null;
  recipientMasked: string;
  auditId: string;
  error?: string;
}

@Injectable()
export class AdminTemplateTestSendService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly templates: AdminTemplatesService,
    private readonly templateService: TemplateService,
    private readonly providers: ProviderRegistry,
    private readonly executor: ProviderExecutor,
    private readonly config: ConfigService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(AdminTemplateTestSendService.name);
  }

  async send(
    tenantId: string,
    admin: AdminPrincipal,
    templateId: string,
    dto: TestSendTemplateDto,
  ): Promise<TestSendResult> {
    const mode = this.config.getOrThrow<'development' | 'staging' | 'production'>('NOTIFHUB_MODE');

    if (dto.requestKey !== undefined) {
      const existing = await this.prisma.templateTestSend.findFirst({
        where: { tenantId, requestKey: dto.requestKey },
      });

      if (existing !== null) {
        return toTestSendResult(existing, mode);
      }
    }

    const template = await this.templates.getRenderable(tenantId, templateId);

    if (template.channel !== Channel.email && template.channel !== Channel.whatsapp) {
      throw new BadRequestException(
        'test send hanya didukung untuk channel email dan whatsapp; gunakan preview untuk channel lain',
      );
    }

    const recipient = resolveRecipient(template.channel, dto.recipient);

    await this.enforceRateLimit(tenantId, admin.adminId);
    this.templates.validateForSend(template, dto.sampleData);

    const sampleData = isRecord(dto.sampleData)
      ? dto.sampleData
      : isRecord(template.sampleData)
        ? template.sampleData
        : {};

    let rendered: RenderedTemplate;

    try {
      rendered = this.templateService.render(template, sampleData);
    } catch (error) {
      const message =
        error instanceof TemplateRenderError
          ? error.message
          : error instanceof Error
            ? error.message
            : 'template gagal dirender';

      await this.createAudit(templateId, tenantId, admin, 'failed', message, dto.note);
      throw new BadRequestException(message);
    }

    const provider = this.providers.getOrThrow(template.channel);
    const testSendId = randomUUID();
    const now = new Date();

    const row = await this.prisma.templateTestSend.create({
      data: {
        id: testSendId,
        tenantId,
        templateId,
        templateVersion: template.version,
        channel: template.channel,
        recipientMasked: maskRecipient(template.channel, recipient),
        recipientHash: hashRecipient(recipient),
        requestKey: dto.requestKey ?? null,
        status: 'pending',
        requestedByAdminId: admin.adminId,
        createdAt: now,
      },
    });

    try {
      const result = await this.executor.execute(provider, {
        notificationId: `template-test:${testSendId}`,
        recipientId: `admin-test:${admin.adminId}`,
        tenantId,
        priority: 3,
        templateKey: template.key,
        subject: rendered.subject,
        body: rendered.body,
        text: rendered.text,
        data: sampleData,
        to: recipient,
      });
      const finalStatus = mode === 'development' ? 'simulated' : 'sent';
      const updated = await this.prisma.templateTestSend.update({
        where: { id: testSendId },
        data: {
          status: finalStatus,
          providerName: provider.name,
          providerMessageId: result.providerMessageId,
        },
      });
      await this.createAudit(
        templateId,
        tenantId,
        admin,
        finalStatus,
        undefined,
        dto.note,
        testSendId,
      );

      this.logger.info(
        {
          event: 'template.test_send',
          tenant_id: tenantId,
          template_id: templateId,
          template_version: template.version,
          channel: template.channel,
          mode,
          status: finalStatus,
          test_send_id: testSendId,
        },
        'template test send completed',
      );

      return { ...toTestSendResult(updated, mode), mode };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.prisma.templateTestSend.update({
        where: { id: testSendId },
        data: {
          status: 'failed',
          providerName: provider.name,
          errorCode: 'provider_error',
          errorMessage: message.slice(0, 1000),
        },
      });
      await this.createAudit(
        templateId,
        tenantId,
        admin,
        'failed',
        message,
        dto.note,
        testSendId,
      );

      this.logger.error(
        {
          event: 'template.test_send_failed',
          tenant_id: tenantId,
          template_id: templateId,
          test_send_id: testSendId,
          channel: template.channel,
          error_message: message,
        },
        'template test send failed',
      );

      throw new BadGatewayException(`test send gagal: ${message}`);
    }
  }

  private async enforceRateLimit(tenantId: string, adminId: string): Promise<void> {
    const now = Date.now();
    const hourAgo = new Date(now - 60 * 60 * 1000);
    const dayAgo = new Date(now - 24 * 60 * 60 * 1000);

    const [adminCount, tenantCount] = await Promise.all([
      this.prisma.templateTestSend.count({
        where: { tenantId, requestedByAdminId: adminId, createdAt: { gte: hourAgo } },
      }),
      this.prisma.templateTestSend.count({
        where: { tenantId, createdAt: { gte: dayAgo } },
      }),
    ]);

    if (adminCount >= MAX_PER_ADMIN_HOUR) {
      throw new HttpException(
        `batas test send ${MAX_PER_ADMIN_HOUR}/jam per admin tercapai; coba lagi nanti`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    if (tenantCount >= MAX_PER_TENANT_DAY) {
      throw new HttpException(
        `batas test send ${MAX_PER_TENANT_DAY}/hari per tenant tercapai; coba lagi besok`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private async createAudit(
    templateId: string,
    tenantId: string,
    admin: AdminPrincipal,
    status: string,
    errorMessage: string | undefined,
    note: string | undefined,
    testSendId?: string,
  ): Promise<void> {
    const template = await this.prisma.notificationTemplate.findFirst({
      where: { id: templateId, tenantId },
      select: { version: true },
    });

    if (template === null) {
      return;
    }

    await this.prisma.templateAuditEvent.create({
      data: {
        tenantId,
        templateId,
        templateVersion: template.version,
        action: 'test_sent',
        actorAdminId: admin.adminId,
        actorEmail: admin.email,
        note: note ?? null,
        metadata: {
          status,
          ...(testSendId === undefined ? {} : { testSendId }),
          ...(errorMessage === undefined ? {} : { error: errorMessage.slice(0, 300) }),
        } as Prisma.InputJsonValue,
      },
    });
  }
}

function resolveRecipient(channel: Channel, raw: string): string {
  const trimmed = raw.trim();

  if (channel === Channel.email) {
    if (trimmed.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      throw new BadRequestException('recipient email tidak valid');
    }

    return trimmed;
  }

  const normalized = normalizeWhatsAppNumber(trimmed);

  if (normalized === null) {
    throw new BadRequestException('recipient WhatsApp harus nomor E.164 yang valid (+ dan 8–15 digit)');
  }

  return normalized;
}

function maskRecipient(channel: Channel, recipient: string): string {
  if (channel === Channel.email) {
    const [local, domain] = recipient.split('@');

    if (local === undefined || domain === undefined) {
      return '***';
    }

    return `${local.slice(0, 1)}***@${domain}`;
  }

  return `${recipient.slice(0, 4)}****${recipient.slice(-3)}`;
}

function hashRecipient(recipient: string): string {
  return createHash('sha256').update(recipient).digest('hex');
}

function toTestSendResult(
  row: {
    status: string;
    channel: Channel;
    providerName: string | null;
    providerMessageId: string | null;
    recipientMasked: string;
    errorMessage: string | null;
    id: string;
  },
  mode: 'development' | 'staging' | 'production',
): TestSendResult {
  const status =
    row.status === 'sent' || row.status === 'simulated' || row.status === 'failed'
      ? row.status
      : 'failed';

  return {
    status,
    mode,
    channel: row.channel,
    provider: row.providerName ?? 'unknown',
    providerMessageId: row.providerMessageId,
    recipientMasked: row.recipientMasked,
    auditId: row.id,
    ...(row.errorMessage === null ? {} : { error: row.errorMessage }),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
