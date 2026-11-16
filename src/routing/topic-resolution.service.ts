import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Resolves topic keys to active recipient ids (PART 1 rules 33, 37).
 * Unknown keys are a consumer error; expired members are excluded at resolution.
 */
@Injectable()
export class TopicResolutionService {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(tenantId: string, topicKeys: string[]): Promise<Map<string, string[]>> {
    const keys = [...new Set(topicKeys)];

    if (keys.length === 0) {
      return new Map();
    }

    const topics = await this.prisma.topic.findMany({
      where: { tenantId, key: { in: keys } },
      select: { id: true, key: true },
    });

    if (topics.length !== keys.length) {
      const found = new Set(topics.map((topic) => topic.key));
      const missing = keys.filter((key) => !found.has(key));

      throw new BadRequestException(`unknown topic key(s): ${missing.join(', ')}`);
    }

    const now = new Date();
    const memberships = await this.prisma.topicSubscriber.findMany({
      where: {
        topicId: { in: topics.map((topic) => topic.id) },
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      select: { topicId: true, recipientId: true },
    });

    const keyByTopicId = new Map(topics.map((topic) => [topic.id, topic.key]));
    const byRecipient = new Map<string, Set<string>>();

    for (const membership of memberships) {
      const topicKey = keyByTopicId.get(membership.topicId);

      if (topicKey === undefined) {
        continue;
      }

      const existing = byRecipient.get(membership.recipientId);

      if (existing === undefined) {
        byRecipient.set(membership.recipientId, new Set([topicKey]));
      } else {
        existing.add(topicKey);
      }
    }

    return new Map([...byRecipient].map(([recipientId, keysSet]) => [recipientId, [...keysSet]]));
  }
}
