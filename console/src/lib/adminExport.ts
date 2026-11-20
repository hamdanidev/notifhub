import {
  DEFAULT_RETRY_OPTIONS,
  HttpTransport,
  type OverallStatus,
} from '@notifhub/js';
import { API_BASE_URL } from '../env';
import { getToken } from './session';

export interface ExportNotificationRow {
  id: string;
  createdAt: string;
  templateKey: string;
  overallStatus: OverallStatus;
  targetType: string;
  priority: number;
  recipientCount: number;
  sentCount: number;
  failedCount: number;
  pendingCount: number;
  skippedCount: number;
}

export interface ExportNotificationsResult {
  items: ExportNotificationRow[];
  total: number;
  limit: number;
  truncated: boolean;
}

export interface ExportNotificationsParams {
  status?: OverallStatus;
  templateKey?: string;
  search?: string;
  from?: string;
  to?: string;
  limit?: number;
}

const transport = new HttpTransport(
  `${API_BASE_URL.replace(/\/+$/, '')}/api/v1/admin`,
  async () => getToken() ?? '',
  globalThis.fetch.bind(globalThis),
  DEFAULT_RETRY_OPTIONS,
);

export function exportNotifications(
  params: ExportNotificationsParams,
): Promise<ExportNotificationsResult> {
  const query = new URLSearchParams();

  if (params.limit !== undefined) query.set('limit', String(params.limit));
  if (params.status !== undefined) query.set('status', params.status);
  if (params.templateKey !== undefined && params.templateKey !== '') {
    query.set('templateKey', params.templateKey);
  }
  if (params.search !== undefined && params.search !== '') query.set('search', params.search);
  if (params.from !== undefined) query.set('from', params.from);
  if (params.to !== undefined) query.set('to', params.to);

  const suffix = query.toString();

  return transport.request<ExportNotificationsResult>(
    'GET',
    `/notifications/export${suffix === '' ? '' : `?${suffix}`}`,
  );
}

const CSV_HEADERS = [
  'id',
  'created_at',
  'template_key',
  'status',
  'target_type',
  'priority',
  'recipient_count',
  'sent_count',
  'failed_count',
  'pending_count',
  'skipped_count',
] as const;

/** Quote a CSV cell and neutralise spreadsheet formulas. */
function csvCell(value: string | number | null | undefined): string {
  let text = value === null || value === undefined ? '' : String(value);

  if (/^[=+\-@\t\r]/.test(text)) {
    text = `'${text}`;
  }

  return `"${text.replace(/"/g, '""')}"`;
}

export function notificationsToCsv(rows: ExportNotificationRow[]): string {
  const lines = [CSV_HEADERS.map(csvCell).join(',')];

  for (const row of rows) {
    lines.push(
      [
        row.id,
        row.createdAt,
        row.templateKey,
        row.overallStatus,
        row.targetType,
        row.priority,
        row.recipientCount,
        row.sentCount,
        row.failedCount,
        row.pendingCount,
        row.skippedCount,
      ]
        .map(csvCell)
        .join(','),
    );
  }

  return `${lines.join('\r\n')}\r\n`;
}

export function exportFileName(now = new Date()): string {
  const stamp = now.toISOString().slice(0, 16).replace(/[-:T]/g, '');

  return `notifhub-notifications-${stamp.slice(0, 8)}-${stamp.slice(8)}.csv`;
}

export function downloadCsv(fileName: string, content: string): void {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');

  anchor.href = url;
  anchor.download = fileName;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
