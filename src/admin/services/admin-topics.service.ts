import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type {
  TopicMembersBodyDto,
  TopicMembersResponseDto,
  TopicMutationResponseDto,
  TopicViewDto,
} from '../../topics/dto/topic-members.dto';
import { TopicsService } from '../../topics/topics.service';
import type { AdminListQueryDto } from '../dto/list-query.dto';

export interface AdminTopicListItem extends TopicViewDto {
  displayName: string | null;
  createdAt: string;
  memberCount: number;
}

export interface AdminTopicListResult {
  items: AdminTopicListItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface AdminTopicDetail extends TopicViewDto {
  displayName: string | null;
  memberCount: number;
  expiredCount: number;
  createdAt: string;
  updatedAt: string;
}

@Injectable()
export class AdminTopicsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly topics: TopicsService,
  ) {}

  async list(tenantId: string, query: AdminListQueryDto): Promise<AdminTopicListResult> {
    const limit = query.limit ?? 20;
    const offset = query.offset ?? 0;
    const where = {
      tenantId,
      ...(query.search === undefined
        ? {}
        : { key: { contains: query.search, mode: 'insensitive' as const } }),
    };

    const [rows, total] = await Promise.all([
      this.prisma.topic.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: offset,
        take: limit,
        include: { _count: { select: { subscribers: true } } },
      }),
      this.prisma.topic.count({ where }),
    ]);

    return {
      items: rows.map((topic) => ({
        key: topic.key,
        isTimeBound: topic.isTimeBound,
        mode: topic.mode,
        displayName: topic.displayName,
        createdAt: topic.createdAt.toISOString(),
        memberCount: topic._count.subscribers,
      })),
      total,
      limit,
      offset,
    };
  }

  async detail(tenantId: string, key: string): Promise<AdminTopicDetail> {
    const topic = await this.topics.getTopicOrThrow(tenantId, key);
    const now = new Date();
    const [memberCount, expiredCount] = await Promise.all([
      this.prisma.topicSubscriber.count({ where: { topicId: topic.id } }),
      this.prisma.topicSubscriber.count({
        where: { topicId: topic.id, expiresAt: { lte: now } },
      }),
    ]);

    return {
      key: topic.key,
      isTimeBound: topic.isTimeBound,
      mode: topic.mode,
      displayName: topic.displayName,
      memberCount,
      expiredCount,
      createdAt: topic.createdAt.toISOString(),
      updatedAt: topic.updatedAt.toISOString(),
    };
  }

  async members(
    tenantId: string,
    key: string,
    includeExpired: boolean,
  ): Promise<TopicMembersResponseDto> {
    return this.topics.getMembers(tenantId, key, includeExpired);
  }

  async replaceMembers(
    tenantId: string,
    key: string,
    body: TopicMembersBodyDto,
  ): Promise<TopicMutationResponseDto> {
    return this.topics.replaceMembers(tenantId, key, body);
  }

  async addMembers(
    tenantId: string,
    key: string,
    body: TopicMembersBodyDto,
  ): Promise<TopicMutationResponseDto> {
    return this.topics.addMembers(tenantId, key, body);
  }
}
