import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Topic } from '@prisma/client';
import { PinoLogger } from 'nestjs-pino';
import { PrismaService } from '../prisma/prisma.service';
import type {
  TopicMemberViewDto,
  TopicMembersBodyDto,
  TopicMembersResponseDto,
  TopicMutationResponseDto,
  TopicViewDto,
} from './dto/topic-members.dto';

const TOPIC_KEY_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;
const PUSH_MODE = 'push';

interface NormalizedMember {
  recipientId: string;
  expiresAt: Date | null;
}

/**
 * Topic membership write model (PART 1 rules 33-37).
 *
 * Topics are created on first push (no explicit create step). PUT replaces the whole
 * membership, POST adds/updates a subset. Time-bound topics require an expiry on every
 * operation; expired members are excluded from resolution elsewhere.
 */
@Injectable()
export class TopicsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(TopicsService.name);
  }

  async replaceMembers(
    tenantId: string,
    keyRaw: string,
    body: TopicMembersBodyDto,
  ): Promise<TopicMutationResponseDto> {
    const key = validateTopicKey(keyRaw);
    const members = this.normalizeMembers(body);
    const existing = await this.findTopic(tenantId, key);
    const isTimeBound = resolveIsTimeBound(existing, body.isTimeBound);

    assertTimeBoundExpiry(isTimeBound, members);

    const result = await this.prisma.$transaction(async (tx) => {
      const topic =
        existing ??
        (await tx.topic.create({
          data: { tenantId, key, isTimeBound, mode: PUSH_MODE },
        }));

      const previous = await tx.topicSubscriber.count({ where: { topicId: topic.id } });

      await tx.topicSubscriber.deleteMany({ where: { topicId: topic.id } });

      if (members.length > 0) {
        await tx.topicSubscriber.createMany({
          data: members.map((member) => ({
            topicId: topic.id,
            recipientId: member.recipientId,
            expiresAt: member.expiresAt,
          })),
        });
      }

      return { topic, removed: Math.max(0, previous - members.length) };
    });

    this.logger.info(
      {
        event: 'topic.members.replaced',
        tenant_id: tenantId,
        topic_key: key,
        member_count: members.length,
        removed: result.removed,
      },
      'topic membership replaced',
    );

    return {
      topic: toTopicView(result.topic),
      memberCount: members.length,
      removed: result.removed,
    };
  }

  async addMembers(
    tenantId: string,
    keyRaw: string,
    body: TopicMembersBodyDto,
  ): Promise<TopicMutationResponseDto> {
    const key = validateTopicKey(keyRaw);
    const members = this.normalizeMembers(body);
    const existing = await this.findTopic(tenantId, key);
    const isTimeBound = resolveIsTimeBound(existing, body.isTimeBound);

    assertTimeBoundExpiry(isTimeBound, members);

    const result = await this.prisma.$transaction(async (tx) => {
      const topic =
        existing ??
        (await tx.topic.create({
          data: { tenantId, key, isTimeBound, mode: PUSH_MODE },
        }));

      const existingRows = await tx.topicSubscriber.findMany({
        where: { topicId: topic.id, recipientId: { in: members.map((member) => member.recipientId) } },
        select: { recipientId: true },
      });

      const existingIds = new Set(existingRows.map((row) => row.recipientId));

      for (const member of members) {
        await tx.topicSubscriber.upsert({
          where: {
            topicId_recipientId: { topicId: topic.id, recipientId: member.recipientId },
          },
          update: { expiresAt: member.expiresAt },
          create: {
            topicId: topic.id,
            recipientId: member.recipientId,
            expiresAt: member.expiresAt,
          },
        });
      }

      const memberCount = await tx.topicSubscriber.count({ where: { topicId: topic.id } });

      return {
        topic,
        memberCount,
        added: members.length - existingIds.size,
        updated: existingIds.size,
      };
    });

    this.logger.info(
      {
        event: 'topic.members.added',
        tenant_id: tenantId,
        topic_key: key,
        member_count: result.memberCount,
        added: result.added,
        updated: result.updated,
      },
      'topic members added',
    );

    return {
      topic: toTopicView(result.topic),
      memberCount: result.memberCount,
      added: result.added,
      updated: result.updated,
    };
  }

  async getMembers(
    tenantId: string,
    keyRaw: string,
    includeExpired: boolean,
  ): Promise<TopicMembersResponseDto> {
    const key = validateTopicKey(keyRaw);
    const topic = await this.getTopicOrThrow(tenantId, key);
    const now = new Date();

    const rows = await this.prisma.topicSubscriber.findMany({
      where: {
        topicId: topic.id,
        ...(includeExpired ? {} : { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }),
      },
      orderBy: { addedAt: 'asc' },
    });

    const expiredCount = includeExpired
      ? rows.filter((row) => row.expiresAt !== null && row.expiresAt.getTime() <= now.getTime())
          .length
      : await this.prisma.topicSubscriber.count({
          where: { topicId: topic.id, expiresAt: { lte: now } },
        });

    const members: TopicMemberViewDto[] = rows.map((row) => ({
      recipientId: row.recipientId,
      addedAt: row.addedAt.toISOString(),
      expiresAt: row.expiresAt === null ? null : row.expiresAt.toISOString(),
    }));

    return { topic: toTopicView(topic), members, expiredCount };
  }

  async getTopicOrThrow(tenantId: string, keyRaw: string): Promise<Topic> {
    const key = validateTopicKey(keyRaw);
    const topic = await this.findTopic(tenantId, key);

    if (topic === null) {
      throw new NotFoundException('Topic not found');
    }

    return topic;
  }

  private async findTopic(tenantId: string, key: string): Promise<Topic | null> {
    return this.prisma.topic.findUnique({ where: { tenantId_key: { tenantId, key } } });
  }

  private normalizeMembers(body: TopicMembersBodyDto): NormalizedMember[] {
    const defaultExpiry = body.expiresAt === undefined ? null : new Date(body.expiresAt);

    if (defaultExpiry !== null && Number.isNaN(defaultExpiry.getTime())) {
      throw new BadRequestException('expiresAt must be a valid ISO 8601 timestamp');
    }

    const byRecipient = new Map<string, NormalizedMember>();

    for (const member of body.members) {
      const recipientId = member.recipientId.trim();

      if (recipientId.length === 0) {
        throw new BadRequestException('member recipientId must not be empty');
      }

      const expiresAt =
        member.expiresAt === undefined ? defaultExpiry : new Date(member.expiresAt);

      byRecipient.set(recipientId, { recipientId, expiresAt });
    }

    return [...byRecipient.values()];
  }
}

export function validateTopicKey(keyRaw: string): string {
  const key = keyRaw.trim();

  if (!TOPIC_KEY_PATTERN.test(key)) {
    throw new BadRequestException(
      'topic key must match ^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$',
    );
  }

  return key;
}

function resolveIsTimeBound(existing: Topic | null, requested: boolean | undefined): boolean {
  if (existing === null) {
    return requested ?? false;
  }

  if (requested !== undefined && requested !== existing.isTimeBound) {
    throw new BadRequestException('isTimeBound cannot be changed on an existing topic');
  }

  return existing.isTimeBound;
}

function assertTimeBoundExpiry(isTimeBound: boolean, members: NormalizedMember[]): void {
  if (!isTimeBound) {
    return;
  }

  const missing = members.find((member) => member.expiresAt === null);

  if (missing !== undefined) {
    throw new BadRequestException(
      'expiresAt is required for every member of a time-bound topic',
    );
  }
}

function toTopicView(topic: Topic): TopicViewDto {
  return { key: topic.key, isTimeBound: topic.isTimeBound, mode: topic.mode };
}
