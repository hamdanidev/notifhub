import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { AdminJwtGuard } from '../../auth/admin/admin-jwt.guard';
import { AdminRoles } from '../../auth/admin/admin-roles.decorator';
import {
  TENANT_ADMIN_ROLE,
  TENANT_APPROVER_ROLE,
  type AdminPrincipal,
} from '../../auth/admin/admin.types';
import type { RequestWithId } from '../../common/middleware/request-id.middleware';
import { CurrentAdmin } from '../decorators/current-admin.decorator';
import {
  CloneTemplateDto,
  CreateTemplateDto,
  PreviewSavedTemplateDto,
  PreviewTemplateDto,
  PublishTemplateDto,
  RollbackTemplateDto,
  TemplateAuditQueryDto,
  TemplateListQueryDto,
  TestSendTemplateDto,
  UpdateTemplateDto,
} from '../dto/template.dto';
import {
  AdminTemplatesService,
  type TemplateAuditView,
  type TemplateListResult,
  type TemplateMutationView,
  type TemplateTestSendView,
  type TemplateView,
} from '../services/admin-templates.service';
import { AdminTemplatePreviewService } from '../services/admin-template-preview.service';
import { AdminTemplateApprovalsService, type TemplateApprovalListResult, type TemplateApprovalView } from '../services/admin-template-approvals.service';
import { AdminTemplateDiffService, type TemplateDiffResult } from '../services/admin-template-diff.service';
import { ApprovalQueueQueryDto, SubmitReviewDto } from '../dto/template-approval.dto';
import { AdminTemplateTestSendService, type TestSendResult } from '../services/admin-template-test-send.service';
import { AdminAuditService, adminAuditContextFrom } from '../services/admin-audit.service';
import type { TemplatePreviewResult } from '../../templates/template.types';

@ApiTags('admin')
@ApiBearerAuth('admin-jwt')
@Controller('admin/templates')
@UseGuards(AdminJwtGuard)
export class AdminTemplatesController {
  constructor(
    private readonly templates: AdminTemplatesService,
    private readonly preview: AdminTemplatePreviewService,
    private readonly testSend: AdminTemplateTestSendService,
    private readonly adminAudit: AdminAuditService,
    private readonly approvals: AdminTemplateApprovalsService,
    private readonly diff: AdminTemplateDiffService,
  ) {}

  private async recordTemplateAudit(
    admin: AdminPrincipal,
    action: string,
    template: TemplateView,
    request: RequestWithId,
    metadata: Record<string, unknown> = {},
  ): Promise<void> {
    await this.adminAudit.record({
      tenantId: admin.tenantId,
      actor: { adminId: admin.adminId, email: admin.email },
      action,
      targetType: 'template',
      targetId: template.id,
      metadata: {
        key: template.key,
        channel: template.channel,
        locale: template.locale,
        version: template.version,
        ...metadata,
      },
      context: adminAuditContextFrom(request),
    });
  }

  @Get()
  @AdminRoles(TENANT_ADMIN_ROLE, TENANT_APPROVER_ROLE)
  @ApiOperation({ summary: 'List templates for the tenant' })
  @ApiOkResponse({ description: 'Paginated template list' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid admin token' })
  list(
    @CurrentAdmin() admin: AdminPrincipal,
    @Query() query: TemplateListQueryDto,
  ): Promise<TemplateListResult> {
    return this.templates.list(admin.tenantId, query);
  }

  @Post()
  @ApiOperation({ summary: 'Create a template draft or legacy published template' })
  @ApiCreatedResponse({ description: 'Created template' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid admin token' })
  async create(
    @CurrentAdmin() admin: AdminPrincipal,
    @Body() dto: CreateTemplateDto,
    @Req() request: RequestWithId,
  ): Promise<TemplateMutationView> {
    const created = await this.templates.create(admin.tenantId, admin, dto);
    await this.recordTemplateAudit(admin, 'admin.template.created', created, request);
    return created;
  }

  @Post('preview')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ThrottlerGuard)
  @AdminRoles(TENANT_ADMIN_ROLE, TENANT_APPROVER_ROLE)
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @ApiOperation({ summary: 'Preview unsaved template content' })
  @ApiOkResponse({ description: 'Rendered preview with validation issues' })
  previewInline(
    @CurrentAdmin() admin: AdminPrincipal,
    @Body() dto: PreviewTemplateDto,
  ): Promise<TemplatePreviewResult> {
    return this.preview.previewInline(admin.tenantId, dto);
  }

  @Get(':id')
  @AdminRoles(TENANT_ADMIN_ROLE, TENANT_APPROVER_ROLE)
  @ApiOperation({ summary: 'Get a template' })
  @ApiOkResponse({ description: 'Template detail' })
  @ApiNotFoundResponse({ description: 'Template not found for this tenant' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid admin token' })
  get(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('id') templateId: string,
  ): Promise<TemplateView> {
    return this.templates.get(admin.tenantId, templateId);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update a template (draft in place; published via a new version)' })
  @ApiOkResponse({ description: 'Updated template' })
  @ApiNotFoundResponse({ description: 'Template not found for this tenant' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid admin token' })
  async update(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('id') templateId: string,
    @Body() dto: UpdateTemplateDto,
    @Req() request: RequestWithId,
  ): Promise<TemplateMutationView> {
    const updated = await this.templates.update(admin.tenantId, admin, templateId, dto);
    await this.recordTemplateAudit(admin, 'admin.template.updated', updated, request);
    return updated;
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Deactivate a template (soft delete)' })
  @ApiOkResponse({ description: 'Deactivated template' })
  @ApiNotFoundResponse({ description: 'Template not found for this tenant' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid admin token' })
  async deactivate(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('id') templateId: string,
    @Req() request: RequestWithId,
  ): Promise<TemplateView> {
    const deactivated = await this.templates.deactivate(admin.tenantId, admin, templateId);
    await this.recordTemplateAudit(admin, 'admin.template.deactivated', deactivated, request);
    return deactivated;
  }

  @Post(':id/publish')
  @HttpCode(HttpStatus.OK)
  @AdminRoles(TENANT_ADMIN_ROLE, TENANT_APPROVER_ROLE)
  @ApiOperation({ summary: 'Publish a draft after full validation and approval' })
  @ApiOkResponse({ description: 'Published template' })
  async publish(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('id') templateId: string,
    @Body() dto: PublishTemplateDto,
    @Req() request: RequestWithId,
  ): Promise<TemplateMutationView> {
    const published = await this.templates.publish(admin.tenantId, admin, templateId, dto);
    await this.recordTemplateAudit(admin, 'admin.template.published', published, request);
    return published;
  }

  @Post(':id/activate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Activate the highest published version' })
  @ApiOkResponse({ description: 'Activated template' })
  async activate(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('id') templateId: string,
    @Req() request: RequestWithId,
  ): Promise<TemplateView> {
    const activated = await this.templates.activate(admin.tenantId, admin, templateId);
    await this.recordTemplateAudit(admin, 'admin.template.activated', activated, request);
    return activated;
  }

  @Post(':id/clone')
  @ApiOperation({ summary: 'Clone a template into a new draft' })
  @ApiCreatedResponse({ description: 'Created draft' })
  async clone(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('id') templateId: string,
    @Body() dto: CloneTemplateDto,
    @Req() request: RequestWithId,
  ): Promise<TemplateMutationView> {
    const cloned = await this.templates.clone(admin.tenantId, admin, templateId, dto);
    await this.recordTemplateAudit(admin, 'admin.template.cloned', cloned, request, {
      source_template_id: templateId,
    });
    return cloned;
  }

  @Post(':id/rollback')
  @ApiOperation({ summary: 'Create a draft from a historical version' })
  @ApiCreatedResponse({ description: 'Created rollback draft' })
  async rollback(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('id') templateId: string,
    @Body() dto: RollbackTemplateDto,
    @Req() request: RequestWithId,
  ): Promise<TemplateMutationView> {
    const rolledBack = await this.templates.rollback(admin.tenantId, admin, templateId, dto);
    await this.recordTemplateAudit(admin, 'admin.template.rolled_back', rolledBack, request, {
      source_version: dto.sourceVersion,
    });
    return rolledBack;
  }

  @Get(':id/approvals')
  @AdminRoles(TENANT_ADMIN_ROLE, TENANT_APPROVER_ROLE)
  @ApiOperation({ summary: 'List approval history for a template' })
  @ApiOkResponse({ description: 'Approval list' })
  approvalsForTemplate(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('id') templateId: string,
    @Query() query: ApprovalQueueQueryDto,
  ): Promise<TemplateApprovalListResult> {
    return this.approvals.listForTemplate(admin.tenantId, templateId, query);
  }

  @Get(':id/versions')
  @AdminRoles(TENANT_ADMIN_ROLE, TENANT_APPROVER_ROLE)
  @ApiOperation({ summary: 'List versions for the same key/channel/locale' })
  @ApiOkResponse({ description: 'Version list' })
  versions(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('id') templateId: string,
  ): Promise<TemplateView[]> {
    return this.templates.versions(admin.tenantId, templateId);
  }

  @Get(':id/audit')
  @AdminRoles(TENANT_ADMIN_ROLE, TENANT_APPROVER_ROLE)
  @ApiOperation({ summary: 'List template audit events' })
  @ApiOkResponse({ description: 'Audit list' })
  audit(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('id') templateId: string,
    @Query() query: TemplateAuditQueryDto,
  ): Promise<{ items: TemplateAuditView[]; total: number; limit: number; offset: number }> {
    return this.templates.audit(admin.tenantId, templateId, query);
  }

  @Get(':id/test-sends')
  @AdminRoles(TENANT_ADMIN_ROLE, TENANT_APPROVER_ROLE)
  @ApiOperation({ summary: 'List test sends for a template' })
  @ApiOkResponse({ description: 'Test send list' })
  testSends(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('id') templateId: string,
    @Query() query: TemplateAuditQueryDto,
  ): Promise<{
    items: TemplateTestSendView[];
    total: number;
    limit: number;
    offset: number;
  }> {
    return this.templates.testSends(admin.tenantId, templateId, query);
  }

  @Post(':id/preview')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ThrottlerGuard)
  @AdminRoles(TENANT_ADMIN_ROLE, TENANT_APPROVER_ROLE)
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @ApiOperation({ summary: 'Preview a saved template version' })
  @ApiOkResponse({ description: 'Rendered preview with validation issues' })
  previewSaved(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('id') templateId: string,
    @Body() dto: PreviewSavedTemplateDto,
  ): Promise<TemplatePreviewResult> {
    return this.preview.previewSaved(admin.tenantId, templateId, dto);
  }

  @Post(':id/test-send')
  @HttpCode(HttpStatus.OK)
  @AdminRoles(TENANT_ADMIN_ROLE, TENANT_APPROVER_ROLE)
  @ApiOperation({ summary: 'Send a test email/WhatsApp message' })
  @ApiOkResponse({ description: 'Test send result' })
  sendTest(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('id') templateId: string,
    @Body() dto: TestSendTemplateDto,
  ): Promise<TestSendResult> {
    return this.testSend.send(admin.tenantId, admin, templateId, dto);
  }

  @Post(':id/submit-review')
  @ApiOperation({ summary: 'Submit the current draft revision for approver review' })
  @ApiCreatedResponse({ description: 'Pending approval' })
  submitReview(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('id') templateId: string,
    @Body() dto: SubmitReviewDto,
  ): Promise<TemplateApprovalView> {
    return this.approvals.submit(admin.tenantId, admin, templateId, dto);
  }

  @Get(':id/diff')
  @AdminRoles(TENANT_ADMIN_ROLE, TENANT_APPROVER_ROLE)
  @ApiOperation({ summary: 'Diff two versions of the same template group' })
  @ApiOkResponse({ description: 'Field, block, and rendered diff' })
  diffVersions(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('id') templateId: string,
    @Query('fromVersion') fromVersion?: string,
    @Query('toVersion') toVersion?: string,
  ): Promise<TemplateDiffResult> {
    return this.diff.diff(
      admin.tenantId,
      templateId,
      parseVersion(fromVersion),
      parseVersion(toVersion),
    );
  }
}

function parseVersion(value: string | undefined): number | undefined {
  if (value === undefined || value.trim().length === 0) {
    return undefined;
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new BadRequestException({
      message: 'fromVersion/toVersion harus bilangan bulat >= 1',
      details: { code: 'diff_version_invalid' },
    });
  }

  return parsed;
}
