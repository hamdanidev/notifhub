import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { AdminJwtGuard } from '../../auth/admin/admin-jwt.guard';
import type { AdminPrincipal } from '../../auth/admin/admin.types';
import { CurrentAdmin } from '../decorators/current-admin.decorator';
import {
  AdminAuditListResponseDto,
  AdminAuditQueryDto,
} from '../dto/admin-audit.dto';
import { AdminAuditService } from '../services/admin-audit.service';

/** Read-only, append-only audit trail for tenant-admin mutations. */
@ApiTags('admin')
@ApiBearerAuth('admin-jwt')
@Controller('admin/audit')
@UseGuards(AdminJwtGuard)
export class AdminAuditController {
  constructor(private readonly audit: AdminAuditService) {}

  @Get()
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @ApiOperation({ summary: 'List tenant admin audit events' })
  @ApiOkResponse({ type: AdminAuditListResponseDto })
  list(
    @CurrentAdmin() admin: AdminPrincipal,
    @Query() query: AdminAuditQueryDto,
  ): Promise<AdminAuditListResponseDto> {
    return this.audit.list(admin.tenantId, query);
  }
}
