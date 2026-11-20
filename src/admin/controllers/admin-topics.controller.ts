import {
  Body,
  Controller,
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
import {
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { AdminJwtGuard } from '../../auth/admin/admin-jwt.guard';
import type { AdminPrincipal } from '../../auth/admin/admin.types';
import type { RequestWithId } from '../../common/middleware/request-id.middleware';
import {
  TopicMembersBodyDto,
  TopicMembersResponseDto,
  TopicMutationResponseDto,
  TopicQueryDto,
} from '../../topics/dto/topic-members.dto';
import { CurrentAdmin } from '../decorators/current-admin.decorator';
import { AdminListQueryDto } from '../dto/list-query.dto';
import {
  AdminTopicsService,
  type AdminTopicDetail,
  type AdminTopicListResult,
} from '../services/admin-topics.service';
import { AdminAuditService, adminAuditContextFrom } from '../services/admin-audit.service';

@ApiTags('admin')
@ApiBearerAuth('admin-jwt')
@Controller('admin/topics')
@UseGuards(AdminJwtGuard)
export class AdminTopicsController {
  constructor(
    private readonly topics: AdminTopicsService,
    private readonly audit: AdminAuditService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List topics for the tenant with member counts' })
  @ApiOkResponse({ description: 'Paginated topic list' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid admin token' })
  list(
    @CurrentAdmin() admin: AdminPrincipal,
    @Query() query: AdminListQueryDto,
  ): Promise<AdminTopicListResult> {
    return this.topics.list(admin.tenantId, query);
  }

  @Get(':key/members')
  @ApiOperation({ summary: 'List topic members' })
  @ApiParam({ name: 'key' })
  @ApiOkResponse({ type: TopicMembersResponseDto })
  @ApiNotFoundResponse({ description: 'Topic not found for this tenant' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid admin token' })
  members(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('key') key: string,
    @Query() query: TopicQueryDto,
  ): Promise<TopicMembersResponseDto> {
    return this.topics.members(admin.tenantId, key, query.includeExpired ?? false);
  }

  @Put(':key/members')
  @ApiOperation({ summary: 'Replace topic membership (admin)' })
  @ApiParam({ name: 'key' })
  @ApiOkResponse({ type: TopicMutationResponseDto })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid admin token' })
  async replaceMembers(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('key') key: string,
    @Body() body: TopicMembersBodyDto,
    @Req() request: RequestWithId,
  ): Promise<TopicMutationResponseDto> {
    const result = await this.topics.replaceMembers(admin.tenantId, key, body);
    await this.audit.record({
      tenantId: admin.tenantId,
      actor: { adminId: admin.adminId, email: admin.email },
      action: 'admin.topic.membership_replaced',
      targetType: 'topic',
      targetId: key,
      metadata: { members: body.members.length },
      context: adminAuditContextFrom(request),
    });
    return result;
  }

  @Post(':key/members')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Add or update topic members (admin)' })
  @ApiParam({ name: 'key' })
  @ApiOkResponse({ type: TopicMutationResponseDto })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid admin token' })
  async addMembers(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('key') key: string,
    @Body() body: TopicMembersBodyDto,
    @Req() request: RequestWithId,
  ): Promise<TopicMutationResponseDto> {
    const result = await this.topics.addMembers(admin.tenantId, key, body);
    await this.audit.record({
      tenantId: admin.tenantId,
      actor: { adminId: admin.adminId, email: admin.email },
      action: 'admin.topic.membership_added',
      targetType: 'topic',
      targetId: key,
      metadata: { members: body.members.length },
      context: adminAuditContextFrom(request),
    });
    return result;
  }

  @Get(':key')
  @ApiOperation({ summary: 'Get a topic with member counts' })
  @ApiParam({ name: 'key' })
  @ApiOkResponse({ description: 'Topic detail' })
  @ApiNotFoundResponse({ description: 'Topic not found for this tenant' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid admin token' })
  detail(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('key') key: string,
  ): Promise<AdminTopicDetail> {
    return this.topics.detail(admin.tenantId, key);
  }
}
