import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
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
  CreateTemplateDto,
  TemplateListQueryDto,
  UpdateTemplateDto,
} from '../dto/template.dto';
import {
  AdminTemplatesService,
  type TemplateListResult,
  type TemplateView,
} from '../services/admin-templates.service';

@ApiTags('admin')
@ApiBearerAuth('admin-jwt')
@Controller('admin/templates')
@UseGuards(AdminJwtGuard)
export class AdminTemplatesController {
  constructor(private readonly templates: AdminTemplatesService) {}

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
  @ApiOperation({ summary: 'Create a template' })
  @ApiCreatedResponse({ description: 'Created template' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid admin token' })
  create(
    @CurrentAdmin() admin: AdminPrincipal,
    @Body() dto: CreateTemplateDto,
  ): Promise<TemplateView> {
    return this.templates.create(admin.tenantId, dto);
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
  @ApiOperation({ summary: 'Update a template (subject, body, active, fallback)' })
  @ApiOkResponse({ description: 'Updated template' })
  @ApiNotFoundResponse({ description: 'Template not found for this tenant' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid admin token' })
  update(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('id') templateId: string,
    @Body() dto: UpdateTemplateDto,
  ): Promise<TemplateView> {
    return this.templates.update(admin.tenantId, templateId, dto);
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
    return this.templates.deactivate(admin.tenantId, templateId);
  }
}
