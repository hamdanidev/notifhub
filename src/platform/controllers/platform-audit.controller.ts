import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { PlatformAdminGuard } from '../../auth/admin/platform-admin.guard';
import {
  ListAuditQueryDto,
  PlatformAuditListResponseDto,
} from '../dto/tenant.dto';
import { PlatformAuditService } from '../services/platform-audit.service';

/** Read-only, append-only audit trail for the platform lane. */
@ApiTags('platform')
@ApiBearerAuth('admin-jwt')
@Controller('platform/audit')
@UseGuards(PlatformAdminGuard, ThrottlerGuard)
export class PlatformAuditController {
  constructor(private readonly audit: PlatformAuditService) {}

  @Get()
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @ApiOperation({ summary: 'List platform audit events' })
  @ApiOkResponse({ type: PlatformAuditListResponseDto })
  list(@Query() query: ListAuditQueryDto): Promise<PlatformAuditListResponseDto> {
    return this.audit.list(query);
  }
}
