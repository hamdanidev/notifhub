import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminJwtGuard } from '../../auth/admin/admin-jwt.guard';
import type { AdminPrincipal } from '../../auth/admin/admin.types';
import { CurrentAdmin } from '../decorators/current-admin.decorator';
import {
  CreateTemplateLayoutDto,
  CreateTemplatePartialDto,
  CreateTemplateThemeDto,
  TemplateAssetListQueryDto,
} from '../dto/template-asset.dto';
import {
  AdminTemplateAssetsService,
  type AssetListResult,
  type LayoutView,
  type PartialView,
  type ThemeView,
} from '../services/admin-template-assets.service';

@ApiTags('admin')
@ApiBearerAuth('admin-jwt')
@Controller('admin/template-assets')
@UseGuards(AdminJwtGuard)
export class AdminTemplateAssetsController {
  constructor(private readonly assets: AdminTemplateAssetsService) {}

  @Get('layouts')
  @ApiOperation({ summary: 'List layout versions for the tenant' })
  @ApiOkResponse({ description: 'Layout list' })
  listLayouts(
    @CurrentAdmin() admin: AdminPrincipal,
    @Query() query: TemplateAssetListQueryDto,
  ): Promise<AssetListResult<LayoutView>> {
    return this.assets.listLayouts(admin.tenantId, query);
  }

  @Post('layouts')
  @ApiOperation({ summary: 'Create a new layout version' })
  @ApiCreatedResponse({ description: 'Created layout version' })
  createLayout(
    @CurrentAdmin() admin: AdminPrincipal,
    @Body() dto: CreateTemplateLayoutDto,
  ): Promise<LayoutView> {
    return this.assets.createLayout(admin.tenantId, admin.adminId, dto);
  }

  @Get('layouts/:id')
  @ApiOperation({ summary: 'Get a layout version' })
  getLayout(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('id') id: string,
  ): Promise<LayoutView> {
    return this.assets.getLayout(admin.tenantId, id);
  }

  @Get('themes')
  @ApiOperation({ summary: 'List theme versions for the tenant' })
  @ApiOkResponse({ description: 'Theme list' })
  listThemes(
    @CurrentAdmin() admin: AdminPrincipal,
    @Query() query: TemplateAssetListQueryDto,
  ): Promise<AssetListResult<ThemeView>> {
    return this.assets.listThemes(admin.tenantId, query);
  }

  @Post('themes')
  @ApiOperation({ summary: 'Create a new theme version' })
  @ApiCreatedResponse({ description: 'Created theme version' })
  createTheme(
    @CurrentAdmin() admin: AdminPrincipal,
    @Body() dto: CreateTemplateThemeDto,
  ): Promise<ThemeView> {
    return this.assets.createTheme(admin.tenantId, admin.adminId, dto);
  }

  @Get('themes/:id')
  @ApiOperation({ summary: 'Get a theme version' })
  getTheme(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('id') id: string,
  ): Promise<ThemeView> {
    return this.assets.getTheme(admin.tenantId, id);
  }

  @Get('partials')
  @ApiOperation({ summary: 'List partial versions for the tenant' })
  @ApiOkResponse({ description: 'Partial list' })
  listPartials(
    @CurrentAdmin() admin: AdminPrincipal,
    @Query() query: TemplateAssetListQueryDto,
  ): Promise<AssetListResult<PartialView>> {
    return this.assets.listPartials(admin.tenantId, query);
  }

  @Post('partials')
  @ApiOperation({ summary: 'Create a new partial version' })
  @ApiCreatedResponse({ description: 'Created partial version' })
  createPartial(
    @CurrentAdmin() admin: AdminPrincipal,
    @Body() dto: CreateTemplatePartialDto,
  ): Promise<PartialView> {
    return this.assets.createPartial(admin.tenantId, admin.adminId, dto);
  }

  @Get('partials/:id')
  @ApiOperation({ summary: 'Get a partial version' })
  getPartial(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('id') id: string,
  ): Promise<PartialView> {
    return this.assets.getPartial(admin.tenantId, id);
  }
}
