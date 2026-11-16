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
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiSecurity,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ApiKeyGuard } from '../common/guards/api-key.guard';
import type { RequestWithApiKey, ApiKeyPrincipal } from '../auth/api-key/api-key.types';
import {
  TopicMembersBodyDto,
  TopicMembersResponseDto,
  TopicMutationResponseDto,
  TopicQueryDto,
} from './dto/topic-members.dto';
import { TopicsService } from './topics.service';

@ApiTags('topics')
@ApiSecurity('api-key')
@Controller('topics')
@UseGuards(ApiKeyGuard)
export class TopicsController {
  constructor(private readonly topics: TopicsService) {}

  @Put(':key/members')
  @ApiOperation({
    summary: 'Replace topic membership',
    description:
      'Creates the topic on first push. Replaces the entire membership; members not present in the body are removed. Requires expiresAt for every member when the topic is time-bound.',
  })
  @ApiParam({ name: 'key', example: 'shift:gudang' })
  @ApiHeader({ name: 'X-API-Key', required: true })
  @ApiOkResponse({ type: TopicMutationResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid key, body or missing expiresAt' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid X-API-Key' })
  async replaceMembers(
    @Req() request: RequestWithApiKey,
    @Param('key') key: string,
    @Body() body: TopicMembersBodyDto,
  ): Promise<TopicMutationResponseDto> {
    return this.topics.replaceMembers(this.principal(request).tenantId, key, body);
  }

  @Post(':key/members')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Add or update topic members',
    description: 'Creates the topic on first push. Members not present in the body are kept.',
  })
  @ApiParam({ name: 'key', example: 'shift:gudang' })
  @ApiHeader({ name: 'X-API-Key', required: true })
  @ApiOkResponse({ type: TopicMutationResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid key, body or missing expiresAt' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid X-API-Key' })
  async addMembers(
    @Req() request: RequestWithApiKey,
    @Param('key') key: string,
    @Body() body: TopicMembersBodyDto,
  ): Promise<TopicMutationResponseDto> {
    return this.topics.addMembers(this.principal(request).tenantId, key, body);
  }

  @Get(':key/members')
  @ApiOperation({ summary: 'List topic members (expired members excluded by default)' })
  @ApiParam({ name: 'key', example: 'shift:gudang' })
  @ApiHeader({ name: 'X-API-Key', required: true })
  @ApiOkResponse({ type: TopicMembersResponseDto })
  @ApiNotFoundResponse({ description: 'Topic not found for this tenant' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid X-API-Key' })
  async getMembers(
    @Req() request: RequestWithApiKey,
    @Param('key') key: string,
    @Query() query: TopicQueryDto,
  ): Promise<TopicMembersResponseDto> {
    return this.topics.getMembers(
      this.principal(request).tenantId,
      key,
      query.includeExpired ?? false,
    );
  }

  private principal(request: RequestWithApiKey): ApiKeyPrincipal {
    const principal = request.apiKey;

    if (principal === undefined) {
      throw new UnauthorizedException('Invalid or missing API key');
    }

    return principal;
  }
}
