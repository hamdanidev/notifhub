import {
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
import type { AdminPrincipal } from '../../auth/admin/admin.types';
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
import { AdminTemplateTestSendService, type TestSendResult } from '../services/admin-template-test-send.service';
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
  ) {}

  @Get()
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
  create(
    @CurrentAdmin() admin: AdminPrincipal,
    @Body() dto: CreateTemplateDto,
  ): Promise<TemplateMutationView> {
    return this.templates.create(admin.tenantId, admin, dto);
  }

  @Post('preview')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ThrottlerGuard)
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
  update(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('id') templateId: string,
    @Body() dto: UpdateTemplateDto,
  ): Promise<TemplateMutationView> {
    return this.templates.update(admin.tenantId, admin, templateId, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Deactivate a template (soft delete)' })
  @ApiOkResponse({ description: 'Deactivated template' })
  @ApiNotFoundResponse({ description: 'Template not found for this tenant' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid admin token' })
  deactivate(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('id') templateId: string,
  ): Promise<TemplateView> {
    return this.templates.deactivate(admin.tenantId, admin, templateId);
  }

  @Post(':id/publish')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Publish a draft after full validation' })
  @ApiOkResponse({ description: 'Published template' })
  publish(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('id') templateId: string,
    @Body() dto: PublishTemplateDto,
  ): Promise<TemplateMutationView> {
    return this.templates.publish(admin.tenantId, admin, templateId, dto);
  }

  @Post(':id/activate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Activate the highest published version' })
  @ApiOkResponse({ description: 'Activated template' })
  activate(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('id') templateId: string,
  ): Promise<TemplateView> {
    return this.templates.activate(admin.tenantId, admin, templateId);
  }

  @Post(':id/clone')
  @ApiOperation({ summary: 'Clone a template into a new draft' })
  @ApiCreatedResponse({ description: 'Created draft' })
  clone(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('id') templateId: string,
    @Body() dto: CloneTemplateDto,
  ): Promise<TemplateMutationView> {
    return this.templates.clone(admin.tenantId, admin, templateId, dto);
  }

  @Post(':id/rollback')
  @ApiOperation({ summary: 'Create a draft from a historical version' })
  @ApiCreatedResponse({ description: 'Created rollback draft' })
  rollback(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('id') templateId: string,
    @Body() dto: RollbackTemplateDto,
  ): Promise<TemplateMutationView> {
    return this.templates.rollback(admin.tenantId, admin, templateId, dto);
  }

  @Get(':id/versions')
  @ApiOperation({ summary: 'List versions for the same key/channel/locale' })
  @ApiOkResponse({ description: 'Version list' })
  versions(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('id') templateId: string,
  ): Promise<TemplateView[]> {
    return this.templates.versions(admin.tenantId, templateId);
  }

  @Get(':id/audit')
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
  @ApiOperation({ summary: 'Send a test email/WhatsApp message' })
  @ApiOkResponse({ description: 'Test send result' })
  sendTest(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('id') templateId: string,
    @Body() dto: TestSendTemplateDto,
  ): Promise<TestSendResult> {
    return this.testSend.send(admin.tenantId, admin, templateId, dto);
  }
}
