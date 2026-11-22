import { Controller, Get, HttpCode, HttpStatus, Param, Post, Body, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
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
import { CurrentAdmin } from '../decorators/current-admin.decorator';
import {
  ApprovalNoteDto,
  ApprovalQueueQueryDto,
  RejectApprovalDto,
} from '../dto/template-approval.dto';
import {
  AdminTemplateApprovalsService,
  type ApprovalQueueResult,
  type TemplateApprovalView,
} from '../services/admin-template-approvals.service';

@ApiTags('admin')
@ApiBearerAuth('admin-jwt')
@Controller('admin/template-approvals')
@UseGuards(AdminJwtGuard)
export class AdminTemplateApprovalsController {
  constructor(private readonly approvals: AdminTemplateApprovalsService) {}

  @Get()
  @AdminRoles(TENANT_ADMIN_ROLE, TENANT_APPROVER_ROLE)
  @ApiOperation({ summary: 'List template approval requests for the tenant' })
  @ApiOkResponse({ description: 'Approval queue' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid admin token' })
  queue(
    @CurrentAdmin() admin: AdminPrincipal,
    @Query() query: ApprovalQueueQueryDto,
  ): Promise<ApprovalQueueResult> {
    return this.approvals.queue(admin.tenantId, query);
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @AdminRoles(TENANT_APPROVER_ROLE)
  @ApiOperation({ summary: 'Approve a pending template review (approver role only)' })
  @ApiOkResponse({ description: 'Approved request' })
  approve(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('id') approvalId: string,
    @Body() dto: ApprovalNoteDto,
  ): Promise<TemplateApprovalView> {
    return this.approvals.approve(admin.tenantId, admin, approvalId, dto);
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @AdminRoles(TENANT_APPROVER_ROLE)
  @ApiOperation({ summary: 'Reject a pending template review (approver role only)' })
  @ApiOkResponse({ description: 'Rejected request' })
  reject(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('id') approvalId: string,
    @Body() dto: RejectApprovalDto,
  ): Promise<TemplateApprovalView> {
    return this.approvals.reject(admin.tenantId, admin, approvalId, dto);
  }
}
