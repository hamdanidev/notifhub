import { BadRequestException, Injectable } from '@nestjs/common';
import { IngestService } from '../../ingest/ingest.service';
import type { NotifyDto } from '../../ingest/dto/notify.dto';
import type { ComposeNotificationDto } from '../dto/compose-notification.dto';

export interface ComposeNotificationResult {
  notification_id: string;
}

/**
 * Admin compose path: reuses the ingest service so persistence, idempotency, fan-out, and queue
 * dispatch behave exactly like consumer ingest. The tenant comes from the admin JWT, never body.
 */
@Injectable()
export class AdminNotificationComposeService {
  constructor(private readonly ingest: IngestService) {}

  async compose(
    tenantId: string,
    dto: ComposeNotificationDto,
  ): Promise<ComposeNotificationResult> {
    const recipients = (dto.recipients ?? [])
      .map((recipient) => recipient.trim())
      .filter((recipient) => recipient.length > 0);
    const topics = (dto.topics ?? [])
      .map((topic) => topic.trim())
      .filter((topic) => topic.length > 0);

    if (recipients.length === 0 && topics.length === 0) {
      throw new BadRequestException('recipients or topics must not be empty');
    }

    const notify: NotifyDto = {
      idempotency_key: dto.requestKey,
      template_key: dto.templateKey,
      channels: dto.channels,
      data: dto.data ?? {},
      priority: dto.priority ?? 'normal',
      ...(recipients.length === 0 ? {} : { recipients }),
      ...(topics.length === 0 ? {} : { topics }),
    };

    return this.ingest.enqueue(notify, tenantId);
  }
}
